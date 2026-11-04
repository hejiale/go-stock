import { tool } from "langchain";
import * as z from "zod";
import { getPriceHistory } from "../clients/price";
import { resolveRegion } from "../regions";
import { hourInZone } from "../time";
import { assertNoLeakage, clampWindow } from "../guards";

/**
 * 欧洲日前电价查询（Energy-Charts / ENTSO-E 数据）。
 * 用于价格形态分析、模型校准、误差复盘。
 */
export const priceHistoryTool = tool(
  async ({ market, start, end, granularity }) => {
    const region = resolveRegion(market);
    const safeEnd = clampWindow(end);
    assertNoLeakage(safeEnd, 0);

    const rows = await getPriceHistory({
      market: region.code,
      start,
      end: safeEnd,
      granularity,
    });

    // 控制返回体积：原始 96 点对模型没意义，压缩成小时统计 + 极值点
    return JSON.stringify(compressPrices(rows, region.timezone));
  },
  {
    name: "get_price_history",
    description:
      "查询欧洲电力市场日前电价（EUR/MWh）。用于分析价格形态、校准模型、复盘误差。" +
      "时间必须带时区（ISO8601），例如 2026-11-01T00:00:00+01:00。" +
      "market 使用 bidding zone 代码，如 DE-LU / FR / NL / BE / AT / ES / NO1 / SE3；英国用 GB（NESO/N2EX 日前价，小时级）。",
    schema: z.object({
      market: z.string().default("DE-LU").describe("Bidding zone 代码"),
      start: z.string().describe("开始时间，ISO8601 带时区"),
      end: z.string().describe("结束时间，ISO8601 带时区"),
      granularity: z.enum(["15min", "1h"]).default("15min"),
    }),
  }
);

function compressPrices(
  rows: Array<{ ts: string; price: number }>,
  timeZone: string
): Record<string, unknown> {
  if (rows.length === 0) return { count: 0, points: [] };

  const values = rows.map((r) => r.price);
  const max = Math.max(...values);
  const min = Math.min(...values);

  const byHour = new Map<number, number[]>();
  for (const r of rows) {
    const h = hourInZone(r.ts, timeZone);
    const arr = byHour.get(h) ?? [];
    arr.push(r.price);
    byHour.set(h, arr);
  }

  return {
    count: rows.length,
    timezone: timeZone,
    unit: "EUR/MWh",
    stats: {
      mean: round(avg(values)),
      max,
      min,
      negativeCount: values.filter((v) => v < 0).length,
    },
    hourlyMean: [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, vals]) => ({ hour, mean: round(avg(vals)) })),
    extremePoints: [
      { kind: "max", ts: rows.find((r) => r.price === max)?.ts, price: max },
      { kind: "min", ts: rows.find((r) => r.price === min)?.ts, price: min },
    ],
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}