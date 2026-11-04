import * as z from "zod";

/**
 * 结构化输出。
 * 强制模型按固定字段返回，前端可直接渲染，也方便入库与评测。
 */
export const ForecastReport = z.object({
  market: z.string().describe("Bidding zone，如 DE-LU / FR / NO1"),
  targetDate: z.string().describe("目标日期 YYYY-MM-DD"),
  granularity: z.enum(["15min", "1h"]),
  currency: z.literal("EUR").default("EUR"),
  unit: z.literal("EUR/MWh").default("EUR/MWh"),

  summary: z.object({
    meanPrice: z.number().describe("P50 均值，EUR/MWh"),
    maxPrice: z.number(),
    minPrice: z.number(),
    peakWindows: z.array(z.string()).describe("高价时段，如 18:00-20:00"),
    negativeWindows: z.array(z.string()).describe("负电价时段，无则为空"),
  }),

  points: z
    .array(
      z.object({
        ts: z.string().describe("带时区 ISO8601"),
        p10: z.number(),
        p50: z.number(),
        p90: z.number(),
      })
    )
    .describe("分时预测点；可只保留关键点，完整序列由后端存库"),

  drivers: z.array(z.string()).describe("主要驱动：天气/负荷/新能源/检修/燃料/节假日"),
  risks: z.array(z.string()).describe("不确定性来源与尾部风险"),
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string().describe("简要推理，不超过 200 字"),

  sources: z
    .array(
      z.object({
        tool: z.string(),
        detail: z.string().optional(),
      })
    )
    .describe("数据来源：本次实际调用的工具"),
});

export type ForecastReportType = z.infer<typeof ForecastReport>;