// 统一读取环境变量。Node 22 自带 loadEnvFile，无需 dotenv。
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // .env 不存在时忽略
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function num(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && env(name) !== "" ? v : fallback;
}

export const config = {
  model: env("AGENT_MODEL", "openai:gpt-5"),
  summaryModel: env("AGENT_SUMMARY_MODEL", "openai:gpt-5-nano"),

  /** 默认市场（Energy-Charts bzn） */
  defaultZone: env("DEFAULT_ZONE", "DE-LU"),

  /** 数据源 */
  data: {
    energyChartsBase: env("ENERGY_CHARTS_BASE", "https://api.energy-charts.info"),
    openMeteoBase: env("OPEN_METEO_BASE", "https://api.open-meteo.com"),
    entsoeApiKey: env("ENTSOE_API_KEY"),
    entsoeBase: env("ENTSOE_BASE", "https://web-api.tp.entsoe.eu/api"),
    nesoBase: env("NESO_BASE", "https://api.neso.energy/api/3/action"),
    nesoGbPriceResourceId: env(
      "NESO_GB_PRICE_RESOURCE_ID",
      "4f27eea5-7038-4f73-9740-e3e4ad47c26a"
    ),
  },

  /** 外部预测模型：nixtla（TimeGPT）| custom | local */
  forecast: {
    provider: env("FORECAST_PROVIDER", "nixtla") as "nixtla" | "custom" | "local",
    nixtlaKey: env("NIXTLA_API_KEY"),
    nixtlaBase: env("NIXTLA_BASE", "https://api.nixtla.io"),
    nixtlaModel: env("NIXTLA_MODEL", "timegpt-1"),
    customUrl: env("MODEL_URL"),
    customToken: env("MODEL_TOKEN"),
    timeoutMs: num("MODEL_TIMEOUT_MS", 60_000),
  },

  /** OpenAI 兼容桥（给 go-stock 之类的外部应用调用） */
  bridge: {
    port: num("BRIDGE_PORT", 3001),
  },

  /** MCP 外部数据平台（可选） */
  mcp: {
    energyUrl: env("MCP_ENERGY_URL"),
    token: env("MCP_TOKEN"),
  },

  server: {
    port: num("PORT", 3000),
  },
} as const;