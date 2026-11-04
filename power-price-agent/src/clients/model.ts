// 电价预测模型客户端。
//
// Provider：
// - nixtla : TimeGPT（外部托管，推荐先试用）
//             POST https://api.nixtla.io/v2/forecast
//             Authorization: Bearer <NIXTLA_API_KEY>
// - custom : 你自建的 Python FastAPI / 任意 HTTP 服务
//             POST {MODEL_URL}/predict
// - local  : 内置季节性基线（离线兜底，不依赖任何外部服务）
//
// 注意：LLM 不参与数值预测；它只负责调用本模块并解释结果。

import { config } from "../config";
import { resolveRegion } from "../regions";
import { dayStartInZone, formatInZone } from "../time";
import { postJson } from "./http";
import type { Granularity } from "./price";

export interface HistoryPoint {
  ts: string;
  price: number;
}

export interface PredictRequest {
  market: string;
  targetDate: string;
  granularity: Granularity;
  /** 历史价格（按时间升序） */
  history: HistoryPoint[];
  /** 由后端拼接的特征摘要（custom provider 使用） */
  features: Record<string, unknown>;
}

export interface ForecastPoint {
  ts: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface ForecastResponse {
  market: string;
  targetDate: string;
  granularity: Granularity;
  modelVersion: string;
  points: ForecastPoint[];
  metrics: {
    trainMae?: number;
    coverageP10P90?: number;
  };
  provider: "nixtla" | "custom" | "local";
}

export async function predictPrice(req: PredictRequest): Promise<ForecastResponse> {
  switch (config.forecast.provider) {
    case "nixtla":
      if (config.forecast.nixtlaKey) return predictWithNixtla(req);
      console.warn("[model] 未配置 NIXTLA_API_KEY，降级到本地基线");
      return predictLocal(req);
    case "custom":
      if (config.forecast.customUrl) return predictWithCustom(req);
      console.warn("[model] 未配置 MODEL_URL，降级到本地基线");
      return predictLocal(req);
    default:
      return predictLocal(req);
  }
}

// ---------- TimeGPT ----------

interface NixtlaResponse {
  mean: number[];
  intervals?: Record<string, number[] | number[][]> | null;
}

async function predictWithNixtla(req: PredictRequest): Promise<ForecastResponse> {
  if (req.history.length < 32) {
    throw new Error(`历史数据不足（${req.history.length} 点），至少需要 32 点才能调用 TimeGPT`);
  }

  const stepMin = req.granularity === "15min" ? 15 : 60;
  const h = Math.round((24 * 60) / stepMin);
  const y = req.history.map((p) => p.price);

  const body = {
    freq: req.granularity === "15min" ? "15min" : "h",
    h,
    series: { sizes: [y.length], y },
    level: [80], // 80% 区间 ≈ P10 / P90
    model: config.forecast.nixtlaModel,
    clean_ex_first: true,
  };

  const res = await postJson<NixtlaResponse>(
    `${config.forecast.nixtlaBase}/v2/forecast`,
    body,
    { headers: { Authorization: `Bearer ${config.forecast.nixtlaKey}` } },
    config.forecast.timeoutMs
  );

  const mean = res.mean ?? [];
  if (mean.length < h) {
    throw new Error(`TimeGPT 返回点数不足：${mean.length}/${h}`);
  }

  const { lo, hi } = parseIntervals(res.intervals, h);
  const region = resolveRegion(req.market);
  const start = dayStartInZone(req.targetDate, region.timezone);

  return {
    market: req.market,
    targetDate: req.targetDate,
    granularity: req.granularity,
    modelVersion: `nixtla:${config.forecast.nixtlaModel}`,
    points: mean.slice(0, h).map((p50, i) => ({
      ts: formatInZone(new Date(start.getTime() + i * stepMin * 60_000), region.timezone),
      p10: round(lo[i] ?? p50),
      p50: round(p50),
      p90: round(hi[i] ?? p50),
    })),
    metrics: {},
    provider: "nixtla",
  };
}

/** TimeGPT 的 intervals 可能是 [lower..., upper...]、[[lo,hi],...] 或 [lo,hi]。 */
function parseIntervals(
  intervals: NixtlaResponse["intervals"],
  h: number
): { lo: number[]; hi: number[] } {
  const raw = intervals?.["80"] ?? (intervals as any)?.[80];
  const empty = { lo: [] as number[], hi: [] as number[] };
  if (!Array.isArray(raw)) return empty;

  if (raw.length === 2 * h) {
    const arr = raw as number[];
    return { lo: arr.slice(0, h), hi: arr.slice(h) };
  }
  if (raw.length === h && Array.isArray(raw[0])) {
    const arr = raw as number[][];
    return { lo: arr.map((x) => x[0] ?? 0), hi: arr.map((x) => x[1] ?? 0) };
  }
  if (raw.length === 2 && typeof raw[0] === "number") {
    const arr = raw as number[];
    return { lo: Array(h).fill(arr[0]), hi: Array(h).fill(arr[1]) };
  }
  return empty;
}

// ---------- 自建模型服务 ----------

async function predictWithCustom(req: PredictRequest): Promise<ForecastResponse> {
  const res = await postJson<ForecastResponse>(
    `${config.forecast.customUrl}/predict`,
    {
      market: req.market,
      targetDate: req.targetDate,
      granularity: req.granularity,
      history: req.history,
      features: req.features,
    },
    {
      headers: config.forecast.customToken
        ? { Authorization: `Bearer ${config.forecast.customToken}` }
        : {},
    },
    config.forecast.timeoutMs
  );
  return { ...res, provider: "custom" };
}

// ---------- 本地季节性基线 ----------

/**
 * 按“一天中的时段”求均值，作为零依赖兜底。
 * 不是好模型，但形状合理、可离线跑，方便先验证链路。
 */
function predictLocal(req: PredictRequest): ForecastResponse {
  const region = resolveRegion(req.market);
  const stepMin = req.granularity === "15min" ? 15 : 60;
  const slots = Math.round((24 * 60) / stepMin);

  const buckets = Array.from({ length: slots }, () => [] as number[]);
  for (const p of req.history) {
    const slot = slotOf(p.ts, region.timezone, stepMin);
    if (slot >= 0 && slot < slots) buckets[slot]!.push(p.price);
  }

  const all = req.history.map((p) => p.price);
  const globalMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 200;

  const start = dayStartInZone(req.targetDate, region.timezone);
  const points: ForecastPoint[] = [];

  for (let i = 0; i < slots; i++) {
    const vals = buckets[i]!;
    const p50 = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : globalMean;
    const variance = vals.length
      ? vals.reduce((s, v) => s + (v - p50) ** 2, 0) / vals.length
      : (p50 * 0.25) ** 2;
    const band = Math.max(8, 1.28 * Math.sqrt(variance)); // ~80% 区间

    points.push({
      ts: formatInZone(new Date(start.getTime() + i * stepMin * 60_000), region.timezone),
      p10: round(p50 - band),
      p50: round(p50),
      p90: round(p50 + band),
    });
  }

  return {
    market: req.market,
    targetDate: req.targetDate,
    granularity: req.granularity,
    modelVersion: "local-seasonal-baseline",
    points,
    metrics: {},
    provider: "local",
  };
}

function slotOf(ts: string, timeZone: string, stepMin: number): number {
  const formatted = formatInZone(new Date(ts), timeZone); // YYYY-MM-DDTHH:mm:ss±HH:MM
  const m = formatted.match(/T(\d{2}):(\d{2})/);
  if (!m) return -1;
  return Math.floor((Number(m[1]) * 60 + Number(m[2])) / stepMin);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}