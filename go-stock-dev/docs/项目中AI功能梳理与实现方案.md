# 项目中 AI 功能梳理与实现方案

# go-stock AI 功能梳理

这个项目的 AI 能力不是单一“聊天框”，而是一套完整的 **AI Agent 平台 + 金融业务应用**。先看整体，再逐项拆实现。

---

## 一、先理解：项目里有两套并存的 AI 引擎

### 1. Eino Agent 引擎（主引擎）

基于 `cloudwego/eino`，支持多轮工具调用、任务规划、子 Agent、技能、MCP、知识库、长期记忆等。

主要入口：

- 全页 AI 对话 `agent-chat.vue`
- 悬浮 Agent 助手 `FloatingAgentAssistant.vue`
- 每日复盘 `/每日复盘`
- 盘前策略 `/盘前策略`
- 提示词回测
- 飞书机器人（开启工具时）
- 定时任务中的 AI 分析

核心文件：

- `backend/agent/agent.go`：Agent 创建、模式选择、工具装配
- `backend/agent/agent_api.go`：对话主流程 `ChatWithContext`
- `backend/agent/agent_runner.go`：运行生命周期
- `backend/agent/chat_model_factory.go`：模型适配

### 2. 传统 OpenAI 兼容流式 + Function Calling 引擎（轻量引擎）

不使用 Eino，直接调用 OpenAI 兼容接口，手写流式解析和工具调用循环。

主要入口：

- 个股页面「AI 分析」`stock.vue` → `NewChatStream`
- 市场资讯「AI 总结」`market.vue` → `SummaryStockNews`
- 悬浮 AI 助手 `FloatingAiAssistant.vue` → `SummaryStockNews`
- 独立 Web AI 助手 `ai-assistant-web`

核心文件：

- `backend/data/openai_api.go`
- `backend/data/openai_stream.go`
- `backend/data/openai_tools.go`
- `backend/data/openai_crawler.go`

> 这两套引擎都支持工具调用，但 Eino 引擎能力更完整；轻量引擎更适合“单轮/少轮 + 快速总结”的场景。

---

## 二、AI 功能全景清单

| 分类 | 功能 | 用户入口 | 核心实现 |
|---|---|---|---|
| 模型层 | 多供应商 AI 配置 | 设置 → AI 模型服务 | `AIConfig` + `createChatModel` |
| 对话 | Agent 对话，支持自动/快速/规划/DeepAgents | 全页对话、悬浮助手 | `ChatWithAgent` / `ChatWithContext` |
| 对话 | 视觉理解，图片问股、K 线截图分析 | 对话输入框图片按钮 | `SupportVision` + `buildVisionImageParts` |
| 工具 | 200+ 内置金融工具 | Agent 自动调用 | `backend/agent/tools` + `backend/data/tool_*.go` |
| 扩展 | MCP 外部工具接入 | MCP 服务管理 | `mcp_server_api.go` + `mcp_tools_cache.go` |
| 扩展 | 技能系统 + 技能广场 | `/` 选择技能、技能管理 | `SKILL.md` + Eino skill 中间件 |
| 知识 | 知识库 RAG | 研究中心 → 知识库 | `chromem-go` + embedding |
| 记忆 | 长期记忆 | 自动沉淀 | `qa_history` 向量集合 |
| 个性化 | 用户画像 + 反馈学习 | Agent 对我的了解 | `user_profile_learner.go` |
| 自进化 | SOUL / MEMORY / LEARNINGS | 自动运行 | `agent_self_evolution.go` |
| 业务 | 每日复盘 | 复盘策略 → 每日复盘 | `daily_review_api.go` |
| 业务 | 盘前策略 | 复盘策略 → 盘前策略 | `morning_strategy_api.go` |
| 业务 | AI 荐股 + 自动保存 + 预警 | AI 推荐列表 | `auto_recommend_saver.go` |
| 回测 | 推荐回测 | 推荐回测统计 | `recommend_backtest.go` |
| 回测 | 提示词模板回测 | 提示词回测 | `prompt_backtest_engine.go` |
| 分析 | 个股 AI 分析 | 个股页 | `data.OpenAi.NewChatStream` |
| 分析 | 市场资讯 AI 总结 | 市场页、悬浮助手 | `NewSummaryStockNewsStreamWithTools` |
| 定时 | AI 定时任务 | 任务管理 | `cron_task_api.go` |
| 分发 | 飞书机器人 | 设置 → 飞书机器人 | `feishu_bot.go` |
| 分发 | 独立 Web AI 助手 | 浏览器访问 | `ai-assistant-web/server.go` |
| 输出 | Markdown 转图片、会话导出、分享 | 对话结果操作 | `markdown_image_tool.go` 等 |
| 社区 | 提示词广场 / 技能广场 | 研究中心 | `PromptPlazaRequest` + 远端服务 |

---

## 三、AI 基础能力

### 1. 多供应商模型接入

**功能**

- 在设置里新增/编辑多条 AI 配置，可分别绑定不同模型、BaseURL、API Key。
- 支持文本模型、Embedding 模型、视觉模型、思考模式、代理、自定义 Header。
- 自动拉取模型列表和上下文窗口信息。

**实现**

- 配置模型：`backend/data/settings_api.go` 中的 `AIConfig`
  - `BaseUrl`、`ApiKey`、`ModelName`
  - `ModelType`：`chat` / `embedding`
  - `ContextWindow`、`MaxTokens`
  - `Thinking`、`SupportVision`
  - `EmbeddingModel`
  - `HttpProxy`、`ExtraHeaders`
- 模型路由：`backend/agent/chat_model_factory.go`
  - `detectChatModelProvider`
  - 支持 8 类：
    - OpenAI 兼容
    - 火山方舟 Ark
    - 阿里 DashScope / Qwen
    - OpenRouter
    - Anthropic Claude
    - Ollama
    - Gemini
    - DeepSeek
  - 特殊适配：
    - OpenAI o1/o3/o4、gpt-5+ 使用 `max_completion_tokens`
    - Ollama 显式设置 `num_ctx`，避免默认 4096 截断系统提示和工具 Schema
    - DeepSeek 视觉模型改走 OpenAI 兼容组件，保证 `image_url` 能下发
    - Anthropic 强制要求 `max_tokens`，单独处理
- 模型列表探测：
  - `FetchAiModels`：调用 `/models`
  - `FetchAiModelInfo`：读取 `max_context_length`、`context_length`、`max_output_tokens`
- 代理和自定义 Header：
  - `buildChatModelHTTPClient`
  - Header 支持 `{{sessionId}}`、`{{uuid}}` 模板变量

---

### 2. Agent 对话与四种模式

**入口**

- 全页 AI 对话：`agent-chat.vue`
- 悬浮 Agent 助手：`FloatingAgentAssistant.vue`
- 后端统一调用：`App.ChatWithAgent`
- 内部统一入口：`StockAiAgent.ChatWithContext`

**模式**

| 模式 | 实现 | 特点 |
|---|---|---|
| `react` | Eino `react.NewAgent` | 单轮/少轮工具调用，最快 |
| `plan_execute` | Eino `planexecute.New` | Planner → Executor → Replanner |
| `deepagents` | Eino `prebuilt/deep` | 任务规划 `write_todos`、子 Agent `task`、文件系统、Shell、技能 |
| 自动 | `classifyComplexity` | 按问题意图、长度、多标的、工具组数量选择 |

**自动模式判断**

`backend/agent/agent.go`：

- `DetectQuestionIntent` 识别：
  - 综合报告
  - 行情查询
  - 代码查询
  - 选股
  - 大盘
  - 新闻
  - 资金流
- 综合报告类直接 `PlanExecute`
- 长问题、多标的、跨 5 个以上工具组 → `PlanExecute`
- 其他 → `React`

**上下文组装**

`ChatWithContext` 按顺序拼接：

1. 用户选择的提示词模板 / 默认股票大师人设
2. 静态规则：
   - 强制工具取数、禁止编造
   - 合规边界
   - 错误恢复、并行调用、检索规范
   - 推荐记录保存规则
3. 当前时间 + 全球市场状态
4. 自进化层：
   - `SOUL.md`
   - `MEMORY.md`
   - `.learnings/LEARNINGS.md`
   - 长期记忆语义召回
5. 项目指令：`.go-stock.md` / `AGENTS.md`
6. 用户画像：`memory/user_profile.md`
7. 会话上下文、断点恢复上下文
8. 历史消息（按 token 预算裁剪）

**执行与收尾**

- React：`runReact`
- PlanExecute：`tryPlanExecute`，失败自动降级 React
- DeepAgents：`runDeepAgents`
- 回答完成后统一做：
  - 归档分析报告：`archiveAnalysisReport`
  - 推荐记录自动保存：`autoSaveRecommendRecords`
  - 财务事实校验：`SendFinancialFactCheck`
  - 任务后反思：`triggerPostTaskReflection`
  - 正向反馈沉淀：`triggerPositiveReflection`
  - 保存聊天记忆

**中断**

- `App.ChatWithAgent` 按 `sessionId` 注册取消句柄
- 新请求会取消同一会话上一轮
- 支持 `AbortChatWithAgent`、`AbortChatWithAgentBySession`
- 不同会话可并行

---

### 3. 工具系统：200+ 金融工具

**实现**

- 静态内置工具在 `buildStaticTools()` 中单例构建。
- 工具分组定义在 `backend/agent/tools/tool_groups.go`。
- 按问题过滤：`getToolsByQuestion` → `ClassifyQuestion` → `FilterToolsByGroups`。

**分组**

| 分组 | 典型工具 |
|---|---|
| `base` | 股票代码查询、交易日历、自选、推荐保存、钉钉/飞书推送 |
| `stock_analysis` | K 线、财务、股东、融资融券、概念、研报、龙虎榜、机构预测 |
| `market` | 大盘、全球指数、异动、涨停、宏观、期货、北向资金 |
| `screening` | 条件选股、板块/ETF/基金/可转债/港股/美股筛选 |
| `money_flow` | 个股资金流、板块资金流、成分股、期货持仓 |
| `news_research` | 新闻、公告、研报、互动问答、政策、涨停梯队、华尔街见闻、联网搜索 |
| `ai_analysis` | AI 历史分析、AI 推荐记录 |
| `operations` | 自选、分组、概念、操作计划、交易记录、基金、MCP 管理、Markdown 转图片 |
| `crypto` | 币安永续、OKX 账户/持仓/订单/下单/撤单 |

**工具选择策略**

- 个股分析、行情、资讯、选股、资金流这 5 组常驻。
- 运营、AI 分析、加密等分组需要问题命中关键词才注入，节省 Schema Token。
- 知识库、长期记忆、用户画像工具始终可见。
- 未登记分组的工具默认保留，保证向后兼容。

**工具执行中间件**

`errorRecoveryMiddleware` 做了很多工程优化：

- 只读工具同轮同参数去重缓存
- 单轮工具调用预算限制
- 瞬态网络错误自动重试一次
- 工具 panic 捕获
- 工具结果加 `[tool] [status] [as_of]` 元数据
- 超长工具结果截断，必要时调用 LLM 压缩摘要
- 向前端推送工具调用预告和结果摘要

---

### 4. MCP 外部工具接入

**功能**

- 添加外部 MCP 服务器，支持 `StreamableHTTP` / `SSE`。
- 静态 Headers 鉴权，支持 `{{env.VAR}}`、`{{sessionId}}`、`{{uuid}}`。
- OAuth 2.1：动态客户端注册 + PKCE + loopback 回调，凭证 AES-GCM 加密存储，access token 过期自动刷新。
- “测试连接”会拉取工具列表并写入 `mcp_server_tools`。
- AI 也能通过工具管理 MCP 服务器。

**实现**

- 数据模型：`models.MCPServer`、`models.MCPServerTool`
- 管理 API：`backend/data/mcp_server_api.go`、`mcp_oauth.go`
- 工具加载缓存：`backend/agent/mcp_tools_cache.go`
  - 按服务器 ID 缓存
  - 配置指纹失效
  - 10 分钟 TTL
  - 失败退避 5 分钟
  - 按服务器粒度 singleflight 重建
- 注入逻辑：`backend/agent/agent.go`
  - `maybeGetMCPTools`
  - `selectMCPToolsForQuestion`
  - React / PlanExecute：按问题、系统提示词、技能声明判断
    - 点名服务器 → 整台工具注入
    - 仅工具名/描述命中 → 只注入命中工具，单服务器最多 12 个
    - 完全不相关 → 不加载，避免建连成本
  - DeepAgents：全部 MCP 工具交给 `ToolSearch` 中间件动态检索

---

### 5. 技能系统

**功能**

- 本地技能目录：`skills/<技能名>/SKILL.md`
- 支持附带 `scripts/`、`references/` 等资源。
- `/` 斜杠指令手动选择技能。
- DeepAgents 模式下 AI 根据 `name` / `description` 自主决定是否加载技能。
- 技能可以绑定 MCP 服务器 ID，触发时自动注入对应 MCP 工具。
- 支持导入/导出技能包、内置编辑器、技能广场下载/上传。

**实现**

- 文件系统技能：
  - `buildSkillMiddleware`
  - `tolerantSkillBackend`
  - 单个 `SKILL.md` 格式错误只跳过该技能，不会拖垮整个 Agent
- 斜杠技能：
  - `App.ChatWithAgent` → `buildSkillContext`
  - 读取 `SKILL.md`，剥离 frontmatter
  - 技能正文覆盖系统提示词，并注入“技能激活纪律”
  - 同时把技能激活块拼到用户消息前，确保 DeepAgents 子 Agent 也能感知
- 数据库技能：
  - `models.Skill`
  - 主要保存名称、描述、分类、触发词、MCP 绑定、启停状态
  - 当前主要用于“触发词命中 → 注入该技能声明的 MCP 服务器”
- 技能广场：
  - 远端服务 + 账号/VIP 体系
  - 下载导入 Base64 打包 zip
  - 校验 `SKILL.md`、拦截路径穿越、限制解压写入量

---

### 6. 视觉理解（图片对话）

**功能**

- 上传本地图片、粘贴截图、输入图片 URL。
- 单张 ≤ 8MB，最多 10 张。
- 支持 K 线截图、持仓截图、研报图表等。

**实现**

- 配置开关：`AIConfig.SupportVision`
- 前端：
  - 本地图片先尝试上传免费图床转外链
  - 图床失败回退 base64 data URL
- 后端：
  - `parseImagesJSON`
  - `buildVisionImageParts` 按供应商适配：
    - OpenAI 系 / DeepSeek / Qwen / Ark / OpenRouter：URL 直传
    - Claude：data URL 拆成 raw base64 + MIMEType
    - Gemini / Ollama：后端下载外链转 base64
  - 图片作为 `UserInputMultiContent` 内容块下发
  - 历史消息中的图片不重发，避免请求体膨胀
- 如果模型未开启视觉理解，会明确回复“图片已被忽略”。

---

## 四、知识与记忆体系

### 7. 知识库 RAG

**功能**

- 多知识库管理，每个库独立向量集合。
- 支持文本粘贴、`.txt` / `.md` / `.markdown` 文件。
- 批量上传、异步向量化、进度展示。
- 单库检索、跨全部知识库 + 长期记忆统一检索。
- 知识库问答。
- 知识图谱构建与可视化。
- 作为 Agent 工具自动调用。

**实现**

- 向量库：`chromem-go` 纯 Go 嵌入式向量库，零 CGO。
- 存储：
  - `memory/.vectorstore/`
  - KB 元信息：`.kb_meta.json`
  - 图谱：`.kb_graph_<name>.json`
- 切片：
  - `text_chunker.go`
  - Markdown 标题 → 段落 → 行 → 句号 → 空格 → 字符
  - 目标约 500 rune，重叠 60，中文友好
- Embedding：
  - `buildEmbeddingFunc`
  - 调用 OpenAI 兼容 `/v1/embeddings`
  - 默认 `text-embedding-3-small`
  - 支持环境变量 `GO_STOCK_EMBEDDING_MODEL`
  - 每个 KB 可绑定不同 AI 服务和 embedding 模型
- 异步导入：
  - 文件级并发 + 切片级并发
  - 全局 embedding 信号量限制 5 并发，避免供应商限流
- 检索：
  - `SearchKnowledgeBase(kb, query, topK)`
  - `SearchAllKnowledge(query, topK)`：并发检索所有 KB + 长期记忆，全局重排后截断
- Agent 工具：
  - `ListKnowledgeBases`
  - `SearchKnowledgeBase`
  - `SearchAllKnowledge`
- 知识库问答：
  - 前端先 `SearchAllKnowledge` 拿到 hits
  - `ChatWithAgentKBQA` 把 hits 注入系统提示词
  - Agent 不再重复检索，直接基于命中内容回答
- 知识图谱：
  - `knowledge_graph.go`
  - 用 LLM 从文档切片抽取实体和关系
  - 聚合去重、按权重截断到 500 节点
  - 前端 ECharts 力导向图展示

---

### 8. 长期记忆

**功能**

- AI 每次分析完成后自动归档问答经验。
- 下次提问时按语义召回相关历史经验。
- 与知识库共享统一检索入口。

**实现**

- 存储：
  - 报告全文：`memory/YYYY-MM-DD/HHMMSS_问题.md`
  - 向量集合：`memory/.vectorstore/` 下的 `qa_history`
- 入库：
  - `archiveAnalysisReport` 归档后调用 `AddMemory`
  - 独立 goroutine 异步切片、embedding、写入
  - 文档 ID 包含日期、时间戳、chunk 序号
- 切片：
  - 与知识库共用 `chunkText`
- 召回：
  - `buildSelfEvolutionPrompt` → `SearchRelevant`
  - 默认 Top-K 5
  - 按问题去重，保留最高相似度
  - 支持用户隔离，key 由机器 ID + 会话 ID 组成
- 降级：
  - 向量库不可用时回退到 `memory/` 文件名扫描
  - 所有向量操作失败只记日志，不影响主流程

---

### 9. 用户画像与反馈学习

**功能**

- 自动汇总用户行为，生成 `memory/user_profile.md`。
- 对话时注入用户偏好。
- 前端可预览、编辑、保存、清空、重新学习。
- 👍/👎 反馈会驱动画像纠正学习。

**实现**

- 数据来源 `gatherProfileData`：
  - 自选股列表、市场分布、持仓成本、止损止盈
  - 股票分组
  - 最近 100 条交易记录、买卖统计、止损止盈设置
  - 用户反馈
- 生成：
  - `buildProfileWithLLM`
  - 把行为数据交给 LLM 生成/更新画像
  - 采用增量调和，避免全量重建导致稳定字段漂移
  - 失败时回退规则模板
- 写入：
  - `writeUserProfileAtomic` 原子写
- 注入：
  - `loadUserProfile`
  - 画像以【用户偏好】段落注入系统提示词
  - 可通过 `user_profile.disabled` 关闭
- 反馈：
  - `models.AgentFeedback`
  - `SubmitFeedback` 幂等更新
  - 负面反馈触发 `RelearnAfterCorrection`，有 10 分钟防抖
  - 支持反馈列表、统计、删除、清空
- 前端页面：`user-profile.vue`

---

### 10. Agent 自我进化

**功能**

- 每次任务后自动内省，沉淀经验。
- 经验跨会话注入系统提示词。
- 越用越了解用户和历史教训。

**实现**

- 文件：
  - `SOUL.md`：进化规则 P0-P6
  - `MEMORY.md`：长期记忆
  - `.learnings/LEARNINGS.md`：经验沉淀
- 初始化：
  - `seedSoulIfMissing` 首次运行落盘内置 `soul_seed.md`
  - 已存在不覆盖
  - 用户清空文件即禁用注入
- 注入：
  - `buildSelfEvolutionPrompt`
  - 拼装 SOUL、MEMORY、最近 3 条 LEARNINGS、历史相关经验
  - 文件读取走 mtime 缓存，未修改免读盘
- 任务后反思：
  - `triggerPostTaskReflection`
  - 规则检测，不额外调用 LLM：
    - 不确定表述过多
    - 出现“抱歉/修正/重新分析”
    - 用户情绪词
    - 长回复但未使用工具
  - 命中后追加或合并到 `LEARNINGS.md`
  - 严重信号同步到 `MEMORY.md` 关键经验段
- 正向反思：
  - `triggerPositiveReflection`
  - 检测“太有用了/靠谱/明白了”等满意词
  - 沉淀正向经验，并记录隐式正向反馈

---

## 五、金融业务 AI 功能

### 11. 每日复盘

**功能**

- 收盘后生成当日复盘报告。
- 默认交易日 18:00 自动执行。
- 内容包含：
  - 市场概况与情绪定位
  - 主线与板块
  - 我的交易复盘
  - 龙虎榜与资金
  - 明日展望

**实现**

- 入口：
  - 页面手动：`GenerateDailyReviewNow`
  - 定时任务：`daily_review`
- 主流程：`backend/agent/daily_review_api.go` 的 `GenerateDailyReview`
- 素材拼装 `buildDailyReviewMaterial`：
  1. 当日市场统计、情绪演变、近 5 日趋势
  2. 当日交易记录、盈亏统计
  3. 龙虎榜游资/机构动向
  4. 昨日盘前策略预判
  5. 前一交易日复盘摘要
- 没有数据的段落明确标注“（无数据）”，防止 AI 编造
- 调用 `ChatWithContext` 生成，只消费最终 `Content`，不把 `[STEP]` 中间过程落库
- 存储到 `daily_reviews` 表
- 生成完成推送 `dailyReviewGenerated` 事件
- 页面轮询状态，支持进度展示
- 失败/进程中断有 10 分钟自动复位机制
- 可选推送飞书/钉钉
- 同步保存到 AI 分析报告中心

---

### 12. 盘前策略

**功能**

- 开盘前生成当日盘前必读。
- 默认交易日 09:00 自动执行。
- 内容包含：
  - 隔夜与外围
  - 昨日复盘要点
  - 今日乐观/中性/悲观三情景
  - 关注方向与标的池
  - 仓位与纪律建议
  - 风险提示

**实现**

- `backend/agent/morning_strategy_api.go`
- 素材 `buildMorningStrategyMaterial`：
  1. 昨日复盘全文
  2. 昨日市场统计
  3. 全球主要指数
  4. 昨日龙虎榜游资/机构动向
  5. 自选股清单及止损止盈
- 调用 `ChatWithContext`
- 存储到 `morning_strategies`
- 推送 `morningStrategyGenerated`
- 与每日复盘形成闭环：盘前预判 → 盘后复盘检验

---

### 13. AI 荐股：自动保存、列表、预警、回测

#### AI 推荐记录

**保存路径有两条，防止模型忘记调用工具：**

1. **主路径：工具保存**
   - `CreateAiRecommendStocks`
   - `BatchCreateAiRecommendStocks`
   - 系统提示词 `staticRulesRecommendSave` 要求模型在给出推荐后调用工具
   - 工具会把真实模型名、配置名、系统提示词、用户提示词、模板 ID、PromptHash、技能 ID 写入推荐记录

2. **兜底路径：回复 JSON 自动解析**
   - `autoSaveRecommendRecords`
   - 解析回复中的 `[{code,name,rating,reason}]`
   - 去重、截断、补全交易所后缀
   - 拉取推荐时点实时价
   - 批量写入 `ai_recommend_stocks`
   - 如果本轮已经调用推荐工具，则跳过兜底

#### 推荐列表与预警

- 页面：`aiRecommendStocksList.vue`
- 推荐记录字段：
  - 评级、推荐理由
  - 建议买入价、止盈价、止损价
  - 当前价、推荐时价格
  - 模型、配置、提示词快照、技能 ID
  - 预警开关
- 预警监控：
  - `MonitorAiRecommendStockPrices`
  - 每分钟执行
  - 只在 A 股/港股/美股交易时段运行
  - 对比当前价与建议买入价、止盈价、止损价
  - 触发本地通知、钉钉、飞书、前端事件
  - 同一预警有 5 分钟去重

#### 推荐回测

- 入口：`RunRecommendBacktest`
- 定时任务：3/5/10/20/30 交易日五个持有期
- 核心逻辑：
  - 找出“已满持有期且未回测”的推荐
  - 拉取推荐日之后 N 个交易日 K 线
  - 计算个股收益
  - 拉取沪深 300 `000300.SH` 作为基准
  - 计算超额收益
  - 写入 `ai_recommend_backtest`
  - 回填同日横截面调整：个股收益 − 同日推荐平均收益
- 统计维度：
  - 总体胜率
  - 按评级
  - 按提示词
  - 按模板
  - 按模型
  - 按技能
- 启动补偿：
  - `catchUpRecommendBacktest`
  - 超过 20 小时未执行的回测任务，启动后后台补跑

---

### 14. 提示词模板回测

**功能**

- 用历史交易日重放，比较多个提示词模板的选股质量。
- 支持：
  - 最多 5 个模板
  - 日期区间
  - 持有周期
  - 每日选股上限
  - 重复次数
  - 采样密度

**实现**

- `backend/agent/prompt_backtest_engine.go`
- 调用次数 = 模板数 × 采样交易日数 × 重复次数
- 防未来数据：
  - 指数 K 线过滤到 ≤ 当日
  - 市场统计、龙虎榜、板块资金流、涨停梯队都按日期取历史快照
  - 只使用当日及之前的数据
- 输出契约：
  - 在模板后追加固定 JSON 输出要求
  - 要求只输出 `[{"code","name","rating","reason"}]`
- 解析：
  - `extractPicksJSON`
  - 兼容 Markdown 代码块和前后杂文
- 入库：
  - `prompt_backtest_picks`
- 收益计算：
  - 选股日后 N 交易日实际收益
  - 与沪深 300 对比
- 指标：
  - 胜率 / 超额胜率
  - 平均收益 / 平均超额
  - 波动率 / CV
  - 夏普
  - 最大回撤
  - Jaccard 输出稳定性
- 回测调用通过 `IsPromptBacktest` 标记，不写入真实推荐记录，避免污染推荐回测。

---

### 15. 提示词模板与模板统计

**功能**

- 提示词模板 CRUD。
- 模板版本号自动递增。
- 模板可用于：
  - AI 对话系统提示词
  - 每日复盘
  - 盘前策略
  - 提示词回测
  - 推荐归因
- 提示词广场：浏览、搜索、点赞、收藏、下载、上传、评论、排行榜。

**实现**

- `models.PromptTemplate`
  - `Name`、`Content`、`Type`、`Version`
- 缓存：`getCachedPromptTemplateWithVersion`
- 归因：
  - 推荐记录保存 `SysPromptId`、`PromptHash`、`SysPromptVersion`
  - 回测统计按模板聚合
- 模板统计：
  - `template_backtest.go`
  - 胜率、超额胜率、平均收益、波动率、CV、夏普、最大回撤、综合评分
  - 综合评分 = 超额胜率 40 分 + 收益分 30 分 + 稳定分 30 分
- 提示词广场：
  - `App.PromptPlazaRequest` 代理远端请求
  - 主地址失败自动回退备用地址
  - 支持账号、设备绑定、VIP 权限

---

### 16. 传统 AI 分析能力

#### 个股 AI 分析

- 前端：`stock.vue`
- 后端：`App.NewChatStream` → `data.OpenAi.NewChatStream`
- 实现特点：
  - 并行预取多类上下文：
    - 实时行情
    - 投资者互动
    - GDP/CPI/PPI/PMI
    - 财经日历
    - 其他行情和资讯
  - 支持提示词模板
  - 支持工具调用
  - 流式返回 `newChatStream` 事件

#### 市场资讯 AI 总结

- 前端：`market.vue`、`FloatingAiAssistant.vue`
- 后端：`App.SummaryStockNews`
- 实现：
  - `NewSummaryStockNewsStreamWithTools`
  - 预取宏观数据、财经日历
  - 支持历史消息、图片
  - 支持工具开关
  - 临时屏蔽慢工具 `FilterTempDisabledTools`
  - 流式增量合并，每 100ms 推送一次，降低 IPC 和前端 Markdown 重解析压力
  - 无输出看门狗，避免界面永远停在“AI 分析中”

#### 独立 Web AI 助手

- `ai-assistant-web/server.go`
- 主程序启动时作为子服务运行
- 接口：
  - `/api/ai-configs`
  - `/api/prompts`
  - `/api/session`
  - `/api/chat/summary-stream`
  - `/api/share`
- 内部复用 `NewSummaryStockNewsStreamWithTools`
- 需要 VIP2 及以上权限

---

### 17. AI 定时任务

**任务类型**

- `stock_analysis`：个股 AI 分析
- `market_analysis`：市场 AI 分析
- `daily_review`：每日复盘
- `morning_strategy`：盘前策略
- `recommend_backtest`：推荐回测

**实现**

- 使用 `robfig/cron/v3`
- `InitCronTasks` 应用启动时自动创建默认任务：
  - 每日复盘：交易日 18:00
  - 盘前策略：交易日 09:00
  - 推荐回测：18:30 / 18:40 / 18:50 / 19:00 / 19:10 分别对应 3/5/10/20/30 日
- `ExecuteTask` 按 `task_type` 分发
- 支持：
  - 启用/禁用
  - 立即执行
  - 修改 Cron 表达式
  - 下次执行时间计算
  - 运行结果记录
- 每日复盘/盘前策略支持飞书、钉钉推送

---

### 18. 飞书机器人

**功能**

- 飞书应用机器人，长连接接收消息。
- 用户在飞书里直接和 AI 对话。
- 支持工具、思考模式、多轮记忆、Agent 模式。
- 长回复或表格内容自动转图片回复。

**实现**

- `backend/agent/feishu_bot.go`
- 使用 `larksuite/oapi-sdk-go` 的 WebSocket 长连接
- 监听 `im.message.receive_v1`
- 3 秒内先返回，AI 处理放 goroutine
- 会话隔离：按 chat + user 生成 `sessionID`
- 两种调用方式：
  - `enableTools=true`：走 Eino Agent `ChatWithContext`
  - `enableTools=false`：走轻量 `AskAiWithTools`，工具为空时降级 `AskAi`
- 回复策略：
  - 内容 > 20KB 或含表格/代码块 → Markdown 渲染 PNG 后发图片
  - 图片失败 → 降级飞书卡片
  - 超长内容 → 分片卡片
- 启动/停止/状态查询：
  - `StartFeishuBot`
  - `StopFeishuBot`
  - `GetFeishuBotStatus`

---

### 19. AI 内容输出与协作

- **Markdown 转图片**
  - Agent 工具 `MarkdownToImage`
  - `data.SaveMarkdownImageToFile`
  - 无头 Chrome `chromedp` 渲染
  - 支持标题、表格、代码块、涨跌红绿
  - 输出到 `logs/agent_images/`
- **会话导出**
  - `ExportSessionMarkdown`
  - 系统保存对话框导出 `.md`
- **回答复制/分享**
  - 前端支持复制 AI 正文
  - 支持导出为图片
  - 支持分享到社区
- **分析报告归档**
  - 每次 AI 分析完成写入 `memory/YYYY-MM-DD/`
  - 同时写入 `ai_response_result`，研究中心的“分析报告”可查看

---

## 六、关键存储与文件地图

### SQLite 主要表

| 表 | 用途 |
|---|---|
| `ai_config` | AI 模型服务配置 |
| `prompt_templates` | 提示词模板 |
| `ai_response_result` | AI 分析报告归档 |
| `ai_recommend_stocks` | AI 推荐股票 |
| `ai_recommend_backtest` | 推荐回测结果 |
| `daily_reviews` | 每日复盘 |
| `morning_strategies` | 盘前策略 |
| `prompt_backtest_tasks` | 提示词回测任务 |
| `prompt_backtest_picks` | 回测选股明细 |
| `skills` | 数据库技能 |
| `mcp_servers` | MCP 服务器 |
| `mcp_server_tools` | MCP 工具快照 |
| `agent_feedback` | AI 回答反馈 |
| `cron_tasks` | 定时任务 |
| `chat_memory` | Agent 多轮对话记忆 |
| `ai_assistant_session` | 传统 AI 助手会话 |

### 文件与目录

| 路径 | 用途 |
|---|---|
| `memory/.vectorstore/` | chromem-go 向量库 |
| `memory/.vectorstore/.kb_meta.json` | 知识库元信息 |
| `memory/.vectorstore/.kb_graph_*.json` | 知识图谱 |
| `memory/YYYY-MM-DD/` | AI 分析报告归档 |
| `memory/user_profile.md` | 用户画像 |
| `memory/user_profile.disabled` | 关闭画像注入 |
| `SOUL.md` | 自进化规则 |
| `MEMORY.md` | 长期记忆 |
| `.learnings/LEARNINGS.md` | 经验沉淀 |
| `skills/` | 文件系统技能 |
| `logs/agent_transcript.md` | 长对话摘要转存 |
| `logs/agent_images/` | Markdown 转图片输出 |
| `memory/.agent-runs/` | Agent 运行快照 |

> AI 数据根目录优先取 `GO_STOCK_ROOT_DIR`；否则优先沿用可执行文件目录下已有的智能体数据目录；macOS 双击 `.app` 时使用 `~/Library/Application Support/go-stock`。

---

## 七、工程上的关键设计

1. **Token 预算控制**
   - 解析模型上下文窗口和输出上限
   - 扣减工具 Schema Token
   - 裁剪历史消息
   - 超长工具结果 LLM 摘要
   - DeepAgents 自动摘要中间件
   - 中文 token 估算比默认按字符估算更准确

2. **按问题选工具**
   - 核心研究组常驻
   - 运营/加密等按关键词触发
   - MCP 工具按问题、提示词、技能声明按需注入
   - 大幅减少每轮工具 Schema 占用

3. **多层降级**
   - PlanExecute 失败 → React
   - Agent 失败 → 轻量工具模式
   - 摘要失败 → 保留原始消息
   - 向量库失败 → 文件名扫描
   - 图床上传失败 → base64
   - 飞书图片失败 → 卡片
   - MCP 加载失败 → 退避，不阻塞主流程

4. **防幻觉**
   - 系统提示词强制工具取数
   - 工具结果带 `status=empty/error` 元数据
   - 回答包含金融数字但本轮无成功工具调用时，追加事实校验提醒
   - 复盘/盘前/回测素材无数据时明确标注“（无数据）”
   - 回测严格防止未来数据

5. **安全边界**
   - DeepAgents 文件系统沙箱限制在程序目录
   - Shell 命令拦截危险操作
   - `GO_STOCK_SHELL_READONLY=1` 可开启只读模式
   - 技能包导入校验路径穿越和解压体积
   - OKX 下单需要显式开启 `OKXEnableTrade`，默认只能查询

6. **可观测性**
   - 工具调用链路 `AgentTurnTrace`
   - 工具调用前后前端进度
   - `[STEP]`、`[FACT_CHECK]` 等状态消息
   - 运行快照 `memory/.agent-runs/`
   - 日志记录模型、模式、工具数、耗时、Token 用量

---

## 八、一句话总结

这个项目的 AI 功能可以概括为：

> **以 Eino Agent 为核心，接入多供应商大模型，通过 200+ 金融工具、MCP、技能、知识库和长期记忆，完成“对话分析、个股诊断、市场总结、每日复盘、盘前策略、AI 荐股、推荐回测、提示词回测、飞书机器人和定时任务”等业务闭环，并用用户画像、反馈学习和自进化机制持续提升效果。**

其中两个最容易混淆的点是：

- **全页 Agent 对话 / 复盘 / 策略 / 回测** 走 Eino Agent；
- **个股页 AI 分析 / 市场资讯总结 / 悬浮轻量助手 / 独立 Web 助手** 走传统 OpenAI 兼容流式 + Function Calling。