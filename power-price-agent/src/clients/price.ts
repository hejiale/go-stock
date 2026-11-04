// 电价数据源：Energy-Charts v2（ENTSO-E / EPEX 数据聚合，欧洲日前电价）。
// 文档：https://api.energy-charts.info/
//
// - 免费、无需 key
// - 2025-10 起多数市场为 15 分钟粒度（96 点/日）
// - DE-LU / AT 价格为 CC BY 4.0（Bundesnetzagentur | SMARD.de）
// - 其他区价格仅限私有/内部使用，商用请确认授权

import { config } from "../config";
import { resolveRegion } from "../regions";
import { formatInZone, zonedWallTimeToDate } from "../time";
import { getJson, withRetry } from "./http";
import { cacheGet, cacheKey, cacheSet } from "./cache";

export type Granularity = "15min" | "1h";

export interface PricePoint {
  ts: string; // 带时区 ISO8601
  price: number; // EUR/MWh，可为负
}

export interface PriceQuery {
  market: string;
  start: string;
  end: string;
  granularity?: Granularity;
}

interface EnergyChartsPriceResponse {
  timezone: string;
  unit: string;
  data: Array<{
    timestamp: string;
    values: { day_ahead_price?: number | null };
  }>;
}

export async function getPriceHistory(q: PriceQuery): Promise<PricePoint[]> {
  const region = resolveRegion(q.market);
  if (region.code === "GB") return getGbPriceHistory(q);
  const url = new URL("/v2/price", config.data.energyChartsBase);
  url.searchParams.set("bzn", region.code);
  url.searchParams.set("start", q.start);
  url.searchParams.set("end", q.end);

  const key = cacheKey(["price", url.toString()]);
  const cached = cacheGet<PricePoint[]>(key);
  if (cached) return cached;

  const raw = await withRetry(() => getJson<EnergyChartsPriceResponse>(url.toString()));

  let points: PricePoint[] = raw.data
    .filter((d) => typeof d.values?.day_ahead_price === "number")
    .map((d) => ({ ts: d.timestamp, price: d.values.day_ahead_price as number }));

  if ((q.granularity ?? "15min") === "1h") {
    points = aggregateHourly(points);
  }

  cacheSet(key, points, 5 * 60_000);
  return points;
}

function aggregateHourly(points: PricePoint[]): PricePoint[] {
  const buckets = new Map<string, number[]>();
  for (const p of points) {
    // 用 UTC 小时分桶；欧洲 1h 结算与 UTC 整点对齐
    const h = new Date(p.ts).toISOString().slice(0, 13);
    const arr = buckets.get(h) ?? [];
    arr.push(p.price);
    buckets.set(h, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([h, vals]) => ({
      ts: `${h}:00:00Z`,
      price: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
    }));
}

// ---------- 英国：NESO / N2EX 日前价格 ----------
// 英国不在欧洲日前耦合市场（SDAC）内，Energy-Charts 不支持 GB。
// 使用 NESO Data Portal 的 “Day-Ahead Power Exchange prices (Nord Pool)” 数据集，
// 即 N2EX GB 日前价（小时级，免费、无需 key）。

interface NesoGbRecord {
  Date: string; // YYYY-MM-DD
  "Delivery Period": string; // "HH:MM - HH:MM"
  Price: number;
}

interface NesoSearchResponse {
  success: boolean;
  result?: { records?: NesoGbRecord[] };
}

async function getGbPriceHistory(q: PriceQuery): Promise<PricePoint[]> {
  const startDate = q.start.slice(0, 10);
  const endDate = q.end.slice(0, 10);

  const url =
    `${config.data.nesoBase}/datastore_search` +
    `?resource_id=${encodeURIComponent(config.data.nesoGbPriceResourceId)}` +
    `&limit=2000&sort=_id%20desc`;

  const key = cacheKey(["price-gb", startDate, endDate]);
  const cached = cacheGet<PricePoint[]>(key);
  if (cached) return cached;

  const raw = await withRetry(() => getJson<NesoSearchResponse>(url)).catch((err) => {
    throw new Error(
      `英国价格数据源 NESO 不可用（${(err as Error).message}）。` +
        `英国不在欧洲日前耦合市场内，请改用 DE-LU / FR / NL 等 bidding zone。`
    );
  });

  const records = raw.result?.records ?? [];
  const points: PricePoint[] = [];

  for (const r of records) {
    if (!r.Date || r.Date < startDate || r.Date > endDate) continue;
    if (!Number.isFinite(r.Price)) continue;

    const startHHMM = (r["Delivery Period"] ?? "").split("-")[0]?.trim();
    if (!/^\d{2}:\d{2}$/.test(startHHMM ?? "")) continue;

    const d = zonedWallTimeToDate(r.Date, startHHMM!, "Europe/London");
    points.push({ ts: formatInZone(d, "Europe/London"), price: r.Price });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));

  // N2EX 为小时级；15min 请求时展开成 4 个 15min 点
  let expanded = points;
  if ((q.granularity ?? "15min") === "15min") {
    expanded = [];
    for (const p of points) {
      const base = new Date(p.ts).getTime();
      for (let i = 0; i < 4; i++) {
        expanded.push({
          ts: formatInZone(new Date(base + i * 15 * 60_000), "Europe/London"),
          price: p.price,
        });
      }
    }
  }

  cacheSet(key, expanded, 5 * 60_000);
  return expanded;
}