import { tool } from "langchain";
import * as z from "zod";
import { getWeatherForecast } from "../clients/weather";
import { resolveRegion } from "../regions";
import { hourInZone } from "../time";

/**
 * 气象预报（Open-Meteo，免费）。
 * 电价的核心驱动：温度（负荷）与风速/辐照（新能源）。
 */
export const weatherTool = tool(
  async ({ market, targetDate }) => {
    const region = resolveRegion(market);
    const hours = await getWeatherForecast(region.code, targetDate);

    const temps = hours.map((h) => h.temperatureC);
    const winds = hours.map((h) => h.windMs);
    const irradiance = hours.map((h) => h.irradianceWm2);

    return JSON.stringify({
      market: region.code,
      targetDate,
      timezone: region.timezone,
      source: "Open-Meteo",
      summary: {
        tempMean: round(avg(temps)),
        tempMax: round(Math.max(...temps)),
        tempMin: round(Math.min(...temps)),
        windMean: round(avg(winds)),
        irradiancePeak: round(Math.max(...irradiance)),
        precipitationSum: round(hours.reduce((a, h) => a + h.precipitationMm, 0)),
      },
      peaks: {
        hottestHour: pickHour(hours, (h) => h.temperatureC, "max", region.timezone),
        windiestHour: pickHour(hours, (h) => h.windMs, "max", region.timezone),
        sunniestHour: pickHour(hours, (h) => h.irradianceWm2, "max", region.timezone),
      },
    });
  },
  {
    name: "get_weather_forecast",
    description:
      "获取欧洲目标市场指定日期的气象预报（温度/风速/辐照/降水）。电价预测前应先查天气。",
    schema: z.object({
      market: z.string().default("DE-LU"),
      targetDate: z.string().describe("目标日期 YYYY-MM-DD"),
    }),
  }
);

function pickHour<T extends { ts: string }>(
  rows: T[],
  score: (r: T) => number,
  mode: "max" | "min",
  timeZone: string
): { hour: number; value: number } | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  for (const r of rows) {
    const better = mode === "max" ? score(r) > score(best) : score(r) < score(best);
    if (better) best = r;
  }
  return { hour: hourInZone(best.ts, timeZone), value: round(score(best)) };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}