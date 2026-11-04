import { tool } from "langchain";
import * as z from "zod";
import { getLoadForecast } from "../clients/load";
import { resolveRegion } from "../regions";
import { hourInZone } from "../time";

/**
 * 负荷 / 新能源出力（欧洲）。
 *
 * 有 ENTSO-E token 时返回真实预测（A65/A69）；
 * 否则返回 Energy-Charts 最近实际值作为代理（isForecast=false）。
 */
export const loadForecastTool = tool(
  async ({ market, targetDate, granularity }) => {
    const region = resolveRegion(market);
    const rows = await getLoadForecast(region.code, targetDate, granularity);
    if (rows.length === 0) {
      return JSON.stringify({
        market: region.code,
        targetDate,
        error: "无负荷数据。可配置 ENTSOE_API_KEY 获取欧洲负荷预测。",
      });
    }

    const net = rows.map((r) => r.netLoadMw);
    const peak = rows.reduce((a, b) => (b.netLoadMw > a.netLoadMw ? b : a), rows[0]!);
    const trough = rows.reduce((a, b) => (b.netLoadMw < a.netLoadMw ? b : a), rows[0]!);
    const midday = rows.filter((r) => {
      const h = hourInZone(r.ts, region.timezone);
      return h >= 11 && h <= 14;
    });

    return JSON.stringify({
      market: region.code,
      targetDate,
      granularity,
      timezone: region.timezone,
      unit: "MW",
      isForecast: rows[0]!.isForecast,
      source: rows[0]!.source,
      summary: {
        netLoadMean: Math.round(net.reduce((a, b) => a + b, 0) / net.length),
        netLoadMax: peak.netLoadMw,
        netLoadMin: trough.netLoadMw,
        solarPeakMw: Math.round(Math.max(...rows.map((r) => r.solarMw))),
        windPeakMw: Math.round(Math.max(...rows.map((r) => r.windMw))),
      },
      windows: {
        peak: { ts: peak.ts, netLoadMw: peak.netLoadMw },
        trough: { ts: trough.ts, netLoadMw: trough.netLoadMw },
      },
      // 判断是否存在“午间光伏过剩”（欧洲负电价的常见前兆）
      duckCurve: {
        middaySolarSurplus: midday.some((r) => r.netLoadMw < r.loadMw * 0.55),
      },
    });
  },
  {
    name: "get_load_forecast",
    description:
      "获取欧洲目标市场的负荷、风电、光伏与净负荷。用于解释峰谷和负电价。" +
      "配置 ENTSOE_API_KEY 时为真实预测；否则为最近实际值代理（返回 isForecast=false）。",
    schema: z.object({
      market: z.string().default("DE-LU"),
      targetDate: z.string().describe("YYYY-MM-DD"),
      granularity: z.enum(["15min", "1h"]).default("15min"),
    }),
  }
);