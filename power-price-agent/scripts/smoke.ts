/**
 * 数据链路 smoke test：不依赖 LLM，只验证欧洲数据源 + 预测模型。
 *
 *   npm run smoke                 # 默认 DE-LU，明天
 *   npm run smoke -- FR 2026-11-06
 */
import { config } from "../src/config";
import { resolveRegion } from "../src/regions";
import { getPriceHistory } from "../src/clients/price";
import { getWeatherForecast } from "../src/clients/weather";
import { getLoadForecast } from "../src/clients/load";
import { predictPrice } from "../src/clients/model";

async function main() {
  const zone = process.argv[2] ?? config.defaultZone;
  const targetDate =
    process.argv[3] ??
    new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);

  const region = resolveRegion(zone);
  console.log(`\n=== 市场: ${region.code} (${region.name}) | 目标日: ${targetDate} ===`);
  console.log(`时区: ${region.timezone}`);
  console.log(`预测 provider: ${config.forecast.provider}`);

  const start = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const end = new Date(Date.now() - 60_000).toISOString();

  console.log("\n[1/4] 历史电价 ...");
  const prices = await getPriceHistory({
    market: region.code,
    start,
    end,
    granularity: "15min",
  });
  console.log(`  点数: ${prices.length}`);
  if (prices.length) {
    const vals = prices.map((p) => p.price);
    console.log(
      `  最近: ${prices.at(-1)?.ts} = ${prices.at(-1)?.price} EUR/MWh | 均值 ${avg(vals).toFixed(2)} | 负值 ${vals.filter((v) => v < 0).length}`
    );
  }

  console.log("\n[2/4] 气象预报 ...");
  const weather = await getWeatherForecast(region.code, targetDate);
  console.log(`  点数: ${weather.length}`);
  if (weather.length) {
    console.log(
      `  温度 ${Math.min(...weather.map((w) => w.temperatureC))}~${Math.max(...weather.map((w) => w.temperatureC))}°C | 风速均值 ${avg(weather.map((w) => w.windMs)).toFixed(1)} m/s | 辐照峰值 ${Math.max(...weather.map((w) => w.irradianceWm2))} W/m²`
    );
  }

  console.log("\n[3/4] 负荷/新能源 ...");
  const load = await getLoadForecast(region.code, targetDate, "15min");
  console.log(`  点数: ${load.length} | 来源: ${load[0]?.source ?? "-"} | isForecast=${load[0]?.isForecast}`);
  if (load.length) {
    console.log(
      `  净负荷 ${Math.min(...load.map((l) => l.netLoadMw))}~${Math.max(...load.map((l) => l.netLoadMw))} MW`
    );
  }

  console.log("\n[4/4] 预测模型 ...");
  const forecast = await predictPrice({
    market: region.code,
    targetDate,
    granularity: "15min",
    history: prices.slice(-1344).map((p) => ({ ts: p.ts, price: p.price })),
    features: {},
  });
  const p50 = forecast.points.map((p) => p.p50);
  console.log(`  provider: ${forecast.provider} | model: ${forecast.modelVersion}`);
  console.log(`  点数: ${forecast.points.length}`);
  console.log(
    `  P50 均值 ${avg(p50).toFixed(2)} | 最低 ${Math.min(...p50)} | 最高 ${Math.max(...p50)} EUR/MWh`
  );
  console.log("  样例:", forecast.points.slice(0, 3));

  console.log("\n✅ smoke 完成\n");
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

main().catch((err) => {
  console.error("\n❌ smoke 失败:", err);
  process.exit(1);
});