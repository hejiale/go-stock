// 气象数据源：Open-Meteo（免费、无需 key）。
// 文档：https://open-meteo.com/en/docs
//
// 取市场代表城市的温度、风速、辐照、降水。电价的两个核心驱动：
// - 温度 → 采暖/制冷负荷
// - 风速 + 辐照 → 风电/光伏出力（负电价与午间压价）

import { config } from "../config";
import { resolveRegion } from "../regions";
import { formatInZone } from "../time";
import { getJson, withRetry } from "./http";
import { cacheGet, cacheKey, cacheSet } from "./cache";

export interface WeatherHour {
  ts: string; // 带时区 ISO8601
  temperatureC: number;
  windMs: number;
  irradianceWm2: number;
  precipitationMm: number;
}

interface OpenMeteoResponse {
  timezone: string;
  hourly: {
    time: number[]; // unixtime（秒）
    temperature_2m: number[];
    wind_speed_10m: number[];
    shortwave_radiation: number[];
    precipitation: number[];
  };
}

export async function getWeatherForecast(
  market: string,
  targetDate: string
): Promise<WeatherHour[]> {
  const region = resolveRegion(market);

  const url = new URL("/v1/forecast", config.data.openMeteoBase);
  url.searchParams.set("latitude", String(region.lat));
  url.searchParams.set("longitude", String(region.lon));
  url.searchParams.set(
    "hourly",
    "temperature_2m,wind_speed_10m,shortwave_radiation,precipitation"
  );
  url.searchParams.set("timezone", region.timezone);
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("start_date", targetDate);
  url.searchParams.set("end_date", targetDate);

  const key = cacheKey(["weather", region.code, targetDate]);
  const cached = cacheGet<WeatherHour[]>(key);
  if (cached) return cached;

  const raw = await withRetry(() => getJson<OpenMeteoResponse>(url.toString()));

  const out: WeatherHour[] = raw.hourly.time.map((t, i) => ({
    ts: formatInZone(new Date(t * 1000), region.timezone),
    temperatureC: round(raw.hourly.temperature_2m[i] ?? 0),
    windMs: round(raw.hourly.wind_speed_10m[i] ?? 0),
    irradianceWm2: round(raw.hourly.shortwave_radiation[i] ?? 0),
    precipitationMm: round(raw.hourly.precipitation[i] ?? 0),
  }));

  cacheSet(key, out, 30 * 60_000);
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}