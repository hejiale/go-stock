# power-price-agent

欧洲动态电价预估 Agent。TypeScript + LangChain v1 + Deep Agents。

> LLM 负责编排与解释，数值预测交给外部时序模型（TimeGPT / 自建服务）。

---

## 架构

```
用户 / go-stock
  ↓
Agent（LangChain createAgent）
  ├─ 意图解析：bidding zone / 日期 / 粒度 / 资产
  ├─ 工具：电价（Energy-Charts）、天气（Open-Meteo）、负荷（ENTSO-E）
  ├─ 预测：TimeGPT（Nixtla）或自建 FastAPI
  ├─ RAG：市场规则 / 结算细则 / 历史复盘
  ├─ 技能：日前预估 / 日内修正 / 负电价诊断 / 储能套利
  └─ 输出：P10/P50/P90 + 驱动 + 风险 + 置信度
  ↓
SSE / OpenAI 兼容桥
```

**数据源全部是真实欧洲数据：**

| 数据 | 来源 | 是否需要 Key |
|---|---|---|
| 日前电价 | [Energy-Charts](https://api.energy-charts.info/)（ENTSO-E/EPEX 聚合） | 否 |
| 气象 | [Open-Meteo](https://open-meteo.com/) | 否 |
| 负荷/风光预测 | [ENTSO-E](https://transparency.entsoe.eu/) A65/A69 | 是（免费） |
| 预测模型 | [TimeGPT](https://www.nixtla.io/)（30 天免费试用） | 是 |

---

## 快速开始

```powershell
cd D:\go-stock-dev\power-price-agent
Copy-Item .env.example .env

# 1) 先验证数据链路（不需要 LLM key）
npm run smoke
npm run smoke -- FR 2026-11-06

# 2) 配好 OPENAI_API_KEY 后，跑 Agent CLI
npm run dev

# 3) 起 SSE 服务
npm run server

# 4) 起 OpenAI 兼容桥（给 go-stock 用）
npm run bridge
```

`npm run smoke` 会依次打印：历史电价点数、天气、负荷来源、预测模型输出。
未配置 `NIXTLA_API_KEY` 时会自动降级到本地季节性基线（`provider=local`），方便先看链路。

---

## 目录导览

| 路径 | 作用 |
|---|---|
| `src/regions.ts` | 欧洲 bidding zone 元数据（坐标/时区/EIC） |
| `src/time.ts` | 时区与 DST 安全的格式化 |
| `src/clients/price.ts` | Energy-Charts 日前电价 |
| `src/clients/weather.ts` | Open-Meteo 气象 |
| `src/clients/load.ts` | ENTSO-E A65/A69；未配置时降级代理 |
| `src/clients/model.ts` | TimeGPT / 自建服务 / 本地基线 |
| `src/tools/model.ts` | **核心工具**：拼历史序列 + 调预测 |
| `src/agent/build.ts` | `buildAgent` / `buildChatAgent` / `buildDeepAgent` |
| `src/agent/prompt.ts` | 铁律：数字只能来自工具 |
| `src/server/openai.ts` | **OpenAI 兼容桥**（go-stock 接入点） |
| `src/server/chat.ts` | 原生 SSE 接口 |
| `src/guards.ts` | 防数据泄漏 / 时间窗口 |
| `skills/*/SKILL.md` | 四个业务技能 |
| `docs/architecture.md` | 架构与降级策略 |
| `docs/data-contract.md` | 数据契约 |

---

## 外部预测模型：TimeGPT

推荐先用 TimeGPT，原因：

- REST API，TS 直接调，无需自建推理服务
- 零样本，支持分位数
- 30 天免费试用

配置：

```env
FORECAST_PROVIDER=nixtla
NIXTLA_API_KEY=你的key
NIXTLA_MODEL=timegpt-1
```

请求体（`src/clients/model.ts` 已实现）：

```json
{
  "freq": "15min",
  "h": 96,
  "series": { "sizes": [1344], "y": [/* 14 天历史价格 */] },
  "level": [80],
  "model": "timegpt-1",
  "clean_ex_first": true
}
```

`mean` → P50，`level=80` 的区间 → P10/P90。

**替代方案：**

| 方案 | 适用 | 说明 |
|---|---|---|
| `FORECAST_PROVIDER=custom` | 你有 Python 团队 | 实现 `POST /predict`，见 `docs/data-contract.md` |
| `FORECAST_PROVIDER=local` | 离线/演示 | 季节性基线，仅用于打通链路 |
| Amazon Bedrock + Chronos-Bolt | AWS 环境 | 需要 Bedrock 权限 |
| SageMaker JumpStart Chronos | AWS 环境 | 部署端点后走 `custom` |

> 注意：Chronos-Bolt 目前**没有** Hugging Face 官方 Inference Provider，
> 不能直接用 HF 无服务器 API；要么自部署，要么走 AWS。

---

## 接入 go-stock（替换原 AI Agent）

**不改 go-stock 的 Go 代码**，用 OpenAI 兼容桥：

1. 启动桥：

   ```powershell
   cd D:\go-stock-dev\power-price-agent
   npm run bridge
   # OpenAI-compatible bridge: http://127.0.0.1:3001/v1
   ```

2. 在 go-stock 的「设置 → AI 配置」新增一条：

   | 字段 | 值 |
   |---|---|
   | 名称 | PowerPriceAgent (TS) |
   | BaseUrl | `http://127.0.0.1:3001/v1` |
   | ApiKey | 任意非空（如 `local`） |
   | 模型名 | `power-price-agent` |
   | 模型类型 | chat |

3. 在 AI 助手里选中这个配置。

原理：go-stock 用 OpenAI 兼容接口，桥把请求转给新 Agent，再以标准 SSE 流返回。
原有 Go 代码、工具、页面都不动，随时可以切回原模型。

桥的行为：

- 取最后一条 user 消息作为问题
- 把 go-stock 传来的 system 内容作为**低优先级上下文**附加
- 用 `x-session-id`（或 `user`）做会话隔离
- 支持 `stream: true/false`
- 监听 `127.0.0.1`，默认无鉴权；可设 `BRIDGE_TOKEN` 开启

> ⚠️ 测试期注意：选中这个配置后，go-stock 自身的股票工具不会被执行
> （请求被转给电价 Agent，返回的是电价分析）。
> 想恢复原行为，在 AI 配置里切回其它模型，或删除 `PowerPriceAgent (TS)` 这条配置。
>
> 桥本身需要 `.env` 里有可用的 `OPENAI_API_KEY` / `OPENAI_BASE_URL`：
> 它只是把“模型调用”转给新 Agent，Agent 仍然需要一个 LLM 来推理。

---

## 欧洲市场注意事项

1. **15 分钟结算**：2025-10 起多数日前市场为 96 点/日，不要把小时均值当结算值。
2. **DST 切换日**：23/25 小时，点数不是 96；当前实现按目标日 00:00 顺推，DST 边界需单独校验。
3. **负电价**：德国/丹麦/西班牙午间光伏过剩时常见，必须单列风险。
4. **跨境价差**：邻区价格与输电阻塞会显著影响本地价格。
5. **数据授权**：DE-LU/AT 为 CC BY 4.0；其它区价格仅限私有/内部使用，商用需确认。
6. **防泄漏**：预测只能用目标日之前可得的 data snapshot，回测不能用现在数据库回灌。

---

## 状态

| 模块 | 状态 |
|---|---|
| 欧洲电价 / 天气 | ✅ 已接真实数据 |
| 负荷/风光 | ✅ ENTSO-E（需 key）；无 key 时用实际值代理 |
| 外部预测 | ✅ TimeGPT / custom / local 三档 |
| Agent / 技能 / 结构化输出 | ✅ |
| OpenAI 兼容桥 | ✅ |
| 向量库 | ⚠️ 关键词检索演示，生产换 embeddings + PGVector |
| 会话持久化 | ⚠️ MemorySaver，生产换 SQLite/PG |
| 回测 / 对账 | ⚠️ 待接入 |

---

## 环境要求

- Node.js **>= 22**
- npm 10+