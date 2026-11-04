// 负荷 / 新能源数据源（欧洲）。
//
// 优先级：
// 1. ENTSO-E Transparency Platform（A65 负荷预测 + A69 风光预测）——需要免费 token
// 2. Energy-Charts `/v2/public_power` 最近实际值（代理，非预测）
//
// 说明：ENTSO-E token 注册：https://transparency.entsoe.eu/
// 环境变量：ENTSOE_API_KEY

import { config } from "../config";
import { resolveRegion } from "../regions";
import { addDays, dateInZone, formatInZone } from "../time";
import { getJson, withRetry } from "./http";
import { cacheGet, cacheKey, cacheSet } from "./cache";
import type { Granularity } from "./price";

export interface LoadForecastPoint {
  ts: string;
  loadMw: number;
  windMw: number;
  solarMw: number;
  /** 净负荷 = 负荷 - 风电 - 光伏 */
  netLoadMw: number;
  isForecast: boolean;
  source: string;
}

export async function getLoadForecast(
  market: string,
  targetDate: string,
  granularity: Granularity = "15min"
): Promise<LoadForecastPoint[]> {
  const region = resolveRegion(market);

  // 英国暂无免费负荷预测源（ENTSO-E 不覆盖 GB，Energy-Charts 也不返回 GB）。
  // 直接返回空，让工具明确告知“负荷数据不可用”，避免误用其它市场的数据。
  if (region.code === "GB") return [];

  const key = cacheKey(["load", region.code, targetDate, granularity]);
  const cached = cacheGet<LoadForecastPoint[]>(key);
  if (cached) return cached;

  let points: LoadForecastPoint[] | null = null;
  if (config.data.entsoeApiKey && region.eic) {
    try {
      points = await fetchEntsoe(region, targetDate);
    } catch (err) {
      console.warn("[load] ENTSO-E 失败，降级到 Energy-Charts 实际值:", (err as Error).message);
    }
  }
  if (!points || points.length === 0) {
    // GB 不在 Energy-Charts 覆盖范围；其它市场失败时也降级为空
    points = await fetchEnergyChartsProxy(region.code, targetDate).catch((err) => {
      console.warn("[load] 负荷数据不可用:", (err as Error).message);
      return [] as LoadForecastPoint[];
    });
  }

  if (granularity === "1h") points = aggregateHourly(points, region.timezone);

  cacheSet(key, points, 15 * 60_000);
  return points;
}

// ---------- ENTSO-E ----------

async function fetchEntsoe(
  region: { code: string; eic?: string; timezone: string },
  targetDate: string
): Promise<LoadForecastPoint[]> {
  const eic = region.eic!;
  const start = `${targetDate.replaceAll("-", "")}0000`;
  const end = `${addDaysString(targetDate, 1).replaceAll("-", "")}0000`;

  const [loadXml, genXml] = await Promise.all([
    entsoeRequest({ documentType: "A65", processType: "A01", eic, start, end }),
    entsoeRequest({ documentType: "A69", processType: "A01", eic, start, end }),
  ]);

  const loadSeries = parseEntsoeSeries(loadXml)[0];
  if (!loadSeries) throw new Error("ENTSO-E A65 无数据");

  const gen = parseEntsoeSeries(genXml);
  const wind = gen.filter((s) => s.psrType === "B18" || s.psrType === "B19");
  const solar = gen.filter((s) => s.psrType === "B16");

  const out: LoadForecastPoint[] = [];
  for (let i = 0; i < loadSeries.points.length; i++) {
    const ts = formatInZone(
      new Date(new Date(loadSeries.start).getTime() + i * loadSeries.stepMinutes * 60_000),
      region.timezone
    );
    const loadMw = loadSeries.points[i] ?? 0;
    const windMw = sumAt(wind, loadSeries.start, loadSeries.stepMinutes, i);
    const solarMw = sumAt(solar, loadSeries.start, loadSeries.stepMinutes, i);

    out.push({
      ts,
      loadMw: round(loadMw),
      windMw: round(windMw),
      solarMw: round(solarMw),
      netLoadMw: round(loadMw - windMw - solarMw),
      isForecast: true,
      source: "ENTSO-E A65/A69",
    });
  }
  return out;
}

async function entsoeRequest(p: {
  documentType: string;
  processType: string;
  eic: string;
  start: string;
  end: string;
}): Promise<string> {
  const url = new URL(config.data.entsoeBase);
  url.searchParams.set("securityToken", config.data.entsoeApiKey);
  url.searchParams.set("documentType", p.documentType);
  url.searchParams.set("processType", p.processType);
  url.searchParams.set("outBiddingZone_Domain", p.eic);
  url.searchParams.set("periodStart", p.start);
  url.searchParams.set("periodEnd", p.end);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ENTSO-E HTTP ${res.status}`);
  return res.text();
}

interface EntsoeSeries {
  psrType?: string;
  start: string;
  stepMinutes: number;
  points: number[];
}

function parseEntsoeSeries(xml: string): EntsoeSeries[] {
  const out: EntsoeSeries[] = [];
  const blocks = xml.split("<TimeSeries>").slice(1);

  for (const block of blocks) {
    const psrType = block.match(/<psrType>([^<]+)<\/psrType>/)?.[1];
    const start = block.match(/<timeInterval>\s*<start>([^<]+)<\/start>/)?.[1];
    const resolution = block.match(/<resolution>([^<]+)<\/resolution>/)?.[1] ?? "PT60M";
    if (!start) continue;

    const stepMinutes = parseResolution(resolution);
    const points: number[] = [];
    for (const m of block.matchAll(/<Point>\s*<position>(\d+)<\/position>\s*<quantity>([^<]+)<\/quantity>\s*<\/Point>/g)) {
      const pos = Number(m[1]);
      points[pos - 1] = Number(m[2]);
    }
    out.push({ psrType, start, stepMinutes, points });
  }
  return out;
}

function parseResolution(r: string): number {
  const m = r.match(/PT(\d+)([MH])/);
  if (!m) return 60;
  return m[2] === "H" ? Number(m[1]) * 60 : Number(m[1]);
}

function sumAt(series: EntsoeSeries[], baseStart: string, baseStep: number, index: number): number {
  const ts = new Date(baseStart).getTime() + index * baseStep * 60_000;
  let sum = 0;
  for (const s of series) {
    const offset = Math.round((ts - new Date(s.start).getTime()) / (s.stepMinutes * 60_000));
    if (offset >= 0 && offset < s.points.length) sum += s.points[offset] ?? 0;
  }
  return sum;
}

// ---------- Energy-Charts 代理 ----------

interface PublicPowerResponse {
  timezone: string;
  data: Array<{
    timestamp: string;
    values: Record<string, number | null>;
  }>;
}

async function fetchEnergyChartsProxy(
  zone: string,
  targetDate: string
): Promise<LoadForecastPoint[]> {
  const prev = addDaysString(targetDate, -1);
  const url = new URL("/v2/public_power", config.data.energyChartsBase);
  url.searchParams.set("bzn", zone);
  url.searchParams.set("start", prev);
  url.searchParams.set("end", targetDate);

  const raw = await withRetry(() => getJson<PublicPowerResponse>(url.toString()));
  const out: LoadForecastPoint[] = [];

  for (const d of raw.data) {
    const v = d.values;
    const load = v.load;
    if (typeof load !== "number") continue;
    const wind = (v.wind_onshore ?? 0) + (v.wind_offshore ?? 0);
    const solar = v.solar ?? 0;
    out.push({
      ts: d.timestamp,
      loadMw: round(load),
      windMw: round(wind),
      solarMw: round(solar),
      netLoadMw: round(load - wind - solar),
      isForecast: false,
      source: "Energy-Charts public_power（最近实际值，代理）",
    });
  }
  return out;
}

// ---------- 工具函数 ----------

function aggregateHourly(
  points: LoadForecastPoint[],
  timeZone: string
): LoadForecastPoint[] {
  const buckets = new Map<string, LoadForecastPoint[]>();
  for (const p of points) {
    const h = new Date(p.ts).toISOString().slice(0, 13);
    const arr = buckets.get(h) ?? [];
    arr.push(p);
    buckets.set(h, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([h, arr]) => {
      const first = arr[0]!;
      const avg = (f: (x: LoadForecastPoint) => number) =>
        round(arr.reduce((s, x) => s + f(x), 0) / arr.length);
      const loadMw = avg((x) => x.loadMw);
      const windMw = avg((x) => x.windMw);
      const solarMw = avg((x) => x.solarMw);
      return {
        ts: `${h}:00:00Z`,
        loadMw,
        windMw,
        solarMw,
        netLoadMw: round(loadMw - windMw - solarMw),
        isForecast: first.isForecast,
        source: first.source,
      };
    });
}

function addDaysString(dateStr: string, days: number): string {
  return dateInZone(addDays(new Date(`${dateStr}T12:00:00Z`), days), "UTC");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}