// 历史经验召回（长期记忆的向量部分）。
//
// 演示用内存 + 关键词相似度。生产建议：
//   收盘对账后把 {question, answer, mae, market, date} 写入向量库；
//   下次构建系统提示词时用当前问题召回 top-k，注入“历史经验”段。
//
// 关键：不要召回失败/污染数据；写入前做质量过滤。

export interface ExperienceCase {
  id: string;
  question: string;
  answer: string;
  market: string;
  date: string;
  /** 该次预测的 MAE，用于质量过滤与排序 */
  mae?: number;
}

const cases: ExperienceCase[] = [];

export function addCase(c: ExperienceCase): void {
  // 质量门槛：误差过大或空回答不入库
  if (!c.answer.trim()) return;
  if (c.mae !== undefined && c.mae > 120) return;
  cases.push(c);
  if (cases.length > 500) cases.shift();
}

export function recall(query: string, topK = 3): ExperienceCase[] {
  const q = tokens(query);
  if (q.size === 0) return [];

  return cases
    .map((c) => {
      const t = tokens(`${c.question} ${c.market} ${c.date}`);
      let hit = 0;
      for (const x of q) if (t.has(x)) hit++;
      return { c, score: hit / Math.sqrt(q.size * Math.max(t.size, 1)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.c);
}

export function formatRecalls(items: ExperienceCase[]): string {
  if (items.length === 0) return "";
  return items
    .map(
      (c, i) =>
        `### 历史经验 ${i + 1}（${c.market} ${c.date}${c.mae !== undefined ? `，MAE=${c.mae}` : ""}）\n` +
        `问题：${c.question}\n结论：${c.answer.slice(0, 300)}`
    )
    .join("\n\n");
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z0-9]+/g) ?? []) out.add(w);
  const cjk = lower.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  return out;
}