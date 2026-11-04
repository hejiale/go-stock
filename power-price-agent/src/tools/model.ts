import { tool } from "langchain";
import * as z from "zod";
import { predictPrice, type ForecastResponse, type HistoryPoint } from "../clients/model";
import { getWeatherForecast } from "../clients/weather";
import { getLoadForecast } from "../clients/load";
import { getPriceHistory } from "../clients/price";
import { resolveRegion } from "../regions";
import { hourInZone } from "../time";
import { assertForecastTarget } from "../guards";

/**
 * 核心工具：调用外部电价预测模型。
 *
 * 设计要点：
 * 1. 特征与历史序列由后端拼接（不让模型传），保证可复现、可审计。
 * 2. 返回压缩后的摘要，避免 96 个点塞满上下文。
 * 3. 任何“具体价格数字”都必须经过这里。
 */
export const priceModelTool = tool(
  async ({ market, targetDate, granularity }) => {
    assertForecastTarget(targetDate);
    const region = resolveRegion(market);

    const bundle = await collectFeatures(region, targetDate, granularity);
    const forecast = await predictPrice({
      market: region.code,
      targetDate,
      granularity,
      history: bundle.history,
      features: bundle.features,
    });

    return JSON.stringify(summarize(forecast, region.timezone));
  },
  {
    name: "run_price_model",
    description:
      "调用电价预测模型，输出目标日 P10/P50/P90 分时价格（EUR/MWh）。" +
      "任何涉及具体价格数字的问题都必须先调用此工具，禁止自行估算、插值或编造价格。",
    schema: z.object({
      market: z.string().default("DE-LU").describe("Bidding zone，如 DE-LU / FR / NO1；英国用 GB（N2EX 日前）"),
      targetDate: z.string().describe("目标日期 YYYY-MM-DD"),
      granularity: z.enum(["15min", "1h"]).default("15min"),
    }),
  }
);

interface RegionLike {
  code: string;
  timezone: string;
}

/**
 * 特征拼接：只取目标日之前可得的数据。
 * 历史序列用于 TimeGPT；天气与负荷用于解释与 custom 模型。
 */
async function collectFeatures(
  region: RegionLike,
  targetDate: string,
  granularity: "15min" | "1h"
): Promise<{ history: HistoryPoint[]; features: Record<string, unknown> }> {
  // 14 天历史（15min 约 1344 点，足够 TimeGPT 上下文）
  const histStart = new Date(`${targetDate}T00:00:00Z`);
  histStart.setUTCDate(histStart.getUTCDate() - 14);
  const histEnd = new Date();

  const [prices, weather, load] = await Promise.all([
    getPriceHistory({
      market: region.code,
      start: histStart.toISOString(),
      end: new Date(Math.min(histEnd.getTime(), Date.now() - 1000)).toISOString(),
      granularity,
    }),
    getWeatherForecast(region.code, targetDate),
    getLoadForecast(region.code, targetDate, granularity),
  ]);

  const values = prices.map((p) => p.price);
  const nets = load.map((l) => l.netLoadMw);

  return {
    history: prices.map((p) => ({ ts: p.ts, price: p.price })),
    features: {
      weather: {
        tempMean: mean(weather.map((w) => w.temperatureC)),
        tempMax: Math.max(...weather.map((w) => w.temperatureC)),
        windMean: mean(weather.map((w) => w.windMs)),
        irradiancePeak: Math.max(...weather.map((w) => w.irradianceWm2)),
      },
      load: {
        netLoadMean: nets.length ? Math.round(mean(nets)) : null,
        solarPeak: load.length ? Math.round(Math.max(...load.map((l) => l.solarMw))) : null,
        windPeak: load.length ? Math.round(Math.max(...load.map((l) => l.windMw))) : null,
        isForecast: load[0]?.isForecast ?? false,
        available: load.length > 0,
      },
      priceLags: {
        last3dMean: round(mean(values)),
        last3dMax: values.length ? round(Math.max(...values)) : null,
        last3dMin: values.length ? round(Math.min(...values)) : null,
        last3dNegativeRatio: round(
          values.filter((v) => v < 0).length / Math.max(values.length, 1)
        ),
      },
      calendar: {
        isWeekend: [0, 6].includes(new Date(`${targetDate}T12:00:00Z`).getUTCDay()),
        month: Number(targetDate.slice(5, 7)),
      },
    },
  };
}

function summarize(f: ForecastResponse, timeZone: string) {
  const p50 = f.points.map((p) => p.p50);
  const hours = new Map<number, number[]>();

  for (const p of f.points) {
    const h = hourInZone(p.ts, timeZone);
    const arr = hours.get(h) ?? [];
    arr.push(p.p50);
    hours.set(h, arr);
  }

  return {
    market: f.market,
    targetDate: f.targetDate,
    granularity: f.granularity,
    timezone: timeZone,
    unit: "EUR/MWh",
    modelVersion: f.modelVersion,
    provider: f.provider,
    metrics: f.metrics,
    summary: {
      meanP50: round(mean(p50)),
      maxP50: round(Math.max(...p50)),
      minP50: round(Math.min(...p50)),
      peakWindows: findWindows(f.points, (p) => p.p50 >= quantile(p50, 0.85), timeZone),
      negativeWindows: findWindows(f.points, (p) => p.p50 < 0, timeZone),
    },
    hourlyP50: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, vals]) => ({ hour, p50: round(mean(vals)) })),
    samplePoints: [
      f.points[0],
      f.points[Math.floor(f.points.length / 2)],
      f.points.at(-1),
    ].filter(Boolean),
  };
}

function findWindows(
  points: Array<{ ts: string; p50: number }>,
  pred: (p: { ts: string; p50: number }) => boolean,
  timeZone: string
): string[] {
  const windows: string[] = [];
  let start: string | null = null;
  let prev: Date | null = null;

  for (const p of points) {
    const d = new Date(p.ts);
    if (pred(p)) {
      if (!start) start = p.ts;
      prev = d;
    } else if (start && prev) {
      windows.push(`${fmt(start, timeZone)} ~ ${fmt(prev.toISOString(), timeZone)}`);
      start = null;
      prev = null;
    }
  }
  if (start && prev) windows.push(`${fmt(start, timeZone)} ~ ${fmt(prev.toISOString(), timeZone)}`);
  return windows.slice(0, 6);
}

function fmt(iso: string, timeZone: string): string {
  const h = hourInZone(iso, timeZone);
  const m = iso.match(/T\d{2}:(\d{2})/)?.[1] ?? "00";
  return `${String(h).padStart(2, "0")}:${m}`;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
function quantile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}