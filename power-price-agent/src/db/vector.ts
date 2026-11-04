// 向量库抽象。
//
// 设计：业务只依赖 VectorStore 接口，底层可换 PGVector / Chroma / 内存。
// 默认实现是【关键词 + 二元组】检索，仅用于演示，不是语义检索。
// 生产请替换 similaritySearch 为 embedding + 余弦相似度。

export interface Doc {
  id: string;
  source: string;
  content: string;
  metadata?: Record<string, string>;
}

export interface SearchHit {
  id: string;
  source: string;
  content: string;
  score: number;
}

export interface VectorStore {
  addDocuments(docs: Doc[]): Promise<void>;
  similaritySearch(query: string, topK: number): Promise<SearchHit[]>;
  size(): number;
}

class KeywordVectorStore implements VectorStore {
  private docs: Doc[] = [];

  async addDocuments(docs: Doc[]): Promise<void> {
    this.docs.push(...docs);
  }

  async similaritySearch(query: string, topK: number): Promise<SearchHit[]> {
    const q = tokenize(query);
    if (q.size === 0) return [];

    const scored = this.docs.map((doc) => {
      const d = tokenize(doc.content);
      let hit = 0;
      for (const t of q) if (d.has(t)) hit++;
      // 归一化，避免长文档天然占优
      const score = hit / Math.sqrt(q.size * Math.max(d.size, 1));
      return { ...doc, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ id, source, content, score }) => ({ id, source, content, score }));
  }

  size(): number {
    return this.docs.length;
  }
}

/** 中英文混合的粗糙分词：中文取相邻二元组，英文按单词。 */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();

  for (const word of lower.match(/[a-z0-9_]+/g) ?? []) out.add(word);

  const cjk = lower.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));

  return out;
}

let store: VectorStore | null = null;

export async function getVectorStore(): Promise<VectorStore> {
  if (store) return store;

  store = new KeywordVectorStore();
  await store.addDocuments(SEED_DOCS);
  return store;
}

// 演示用种子文档。生产环境换成真实规则库（带版本号与生效日期）。
const SEED_DOCS: Doc[] = [
  {
    id: "rule-001",
    source: "现货市场结算细则（示例）",
    content:
      "日前市场采用分时竞价出清，15 分钟为一个结算时段。日前申报偏差在实时市场按实时价格结算，偏差考核阈值由各省规则确定。",
  },
  {
    id: "rule-002",
    source: "负电价处理说明（示例）",
    content:
      "当新能源大发且负荷低迷时，市场可能出现负电价。负电价时段发电侧需支付费用，储能与可调负荷可获收益。报价下限由市场规则规定。",
  },
  {
    id: "rule-003",
    source: "储能套利策略（示例）",
    content:
      "储能在谷时充电、峰时放电。决策应基于价差、循环效率、衰减成本与 SOC 约束，而非仅看单点价差。需考虑 P10/P90 区间下的收益风险。",
  },
  {
    id: "rule-004",
    source: "价格预测评估规范（示例）",
    content:
      "电价预测应同时评估 MAE、RMSE 与分位数损失。点预测用 MAE，区间预测用 pinball loss，并统计 P10-P90 覆盖率。峰谷方向准确率单独统计。",
  },
  {
    id: "rule-005",
    source: "检修与阻塞影响（示例）",
    content:
      "机组检修、线路阻塞会显著抬升局部节点电价。预测前应检查目标日的检修公告与输电阻塞计划，并在风险中明确提示。",
  },
];