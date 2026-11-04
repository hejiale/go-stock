import { tool } from "langchain";
import * as z from "zod";
import { getVectorStore } from "../db/vector";

/**
 * 市场规则 / 结算细则 / 历史复盘检索。
 *
 * 注意：RAG 不预拼进系统提示词，而是让模型在需要时主动调用。
 */
export const marketRulesTool = tool(
  async ({ query, topK }) => {
    const store = await getVectorStore();
    const hits = await store.similaritySearch(query, topK);

    if (hits.length === 0) {
      return "未检索到相关规则片段。请只基于已知信息回答，并明确说明规则依据缺失。";
    }

    return hits
      .map(
        (h, i) =>
          `[${i + 1}] 来源：${h.source}（相关度 ${h.score.toFixed(3)}）\n${h.content}`
      )
      .join("\n\n");
  },
  {
    name: "search_market_rules",
    description:
      "检索电力市场规则、结算细则、政策文件与历史复盘。涉及考核、偏差结算、负电价、报价上下限时使用。" +
      "回答规则类问题时必须标注来源。",
    schema: z.object({
      query: z.string().describe("检索语句，尽量具体"),
      topK: z.number().int().min(1).max(10).default(5),
    }),
  }
);