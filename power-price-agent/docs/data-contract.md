# 数据契约与防泄漏规则（欧洲）

## 1. 统一时间格式

所有工具入参、返回值、prompt 上下文，一律使用**带时区的 ISO8601**：

```
2026-11-05T00:00:00+01:00
```

禁止：

- `2026-11-05`（无时区）
- `明天`（相对时间，必须在入口处解析成绝对时间）
- Unix 秒/毫秒混用

## 2. 结算粒度

| 市场 | 粒度 | 每日点数 |
|---|---|---|
| 欧洲日前（2025-10 起） | 15 分钟 | 96 |
| 历史数据 / 部分区 | 1 小时 | 24 |
| DST 切换日 | 15 分钟 | 92 / 100 |

工具必须显式接收 `granularity`，并在返回中回显。

## 3. 防泄漏（关键）

预测目标日 `D` 的价格，只能使用 **D 日某个 cutoff 之前** 可获得的数据。

| 数据 | 可用截止 |
|---|---|
| 历史电价 | D-1 收盘 |
| 日前天气预报 | D 日发布时点之前 |
| 负荷/风光预测 | 与预测时点对齐 |
| 检修/停机公告 | 公告发布时间 ≤ cutoff |
| 燃料价格（TTF/煤） | D-1 收盘 |

回测必须使用“当时可得”的数据快照，不能用现在的数据库回灌。

## 4. 工具返回格式

统一 JSON，数值带单位说明：

```json
{
  "market": "DE-LU",
  "granularity": "15min",
  "timezone": "Europe/Berlin",
  "unit": "EUR/MWh",
  "points": [
    { "ts": "2026-11-05T00:00:00+01:00", "value": 257.39 }
  ],
  "meta": {
    "source": "energy-charts",
    "fetched_at": "2026-11-04T18:00:00+01:00",
    "cutoff": "2026-11-04T16:00:00+01:00"
  }
}
```

## 5. 预测模型服务契约（custom provider）

`POST {MODEL_URL}/predict`

请求：

```json
{
  "market": "DE-LU",
  "targetDate": "2026-11-05",
  "granularity": "15min",
  "history": [
    { "ts": "2026-11-03T00:00:00+01:00", "price": 257.39 }
  ],
  "features": {
    "weather": { "tempMean": 11.2, "windMean": 5.1 },
    "load": { "netLoadMean": 39000, "isForecast": true }
  }
}
```

响应：

```json
{
  "market": "DE-LU",
  "targetDate": "2026-11-05",
  "granularity": "15min",
  "modelVersion": "lgbm-2026.11.1",
  "points": [
    { "ts": "2026-11-05T00:00:00+01:00", "p10": 280.1, "p50": 312.5, "p90": 355.0 }
  ],
  "metrics": { "trainMae": 28.4, "coverageP10P90": 0.81 }
}
```

## 6. TimeGPT 契约

`POST https://api.nixtla.io/v2/forecast`

```json
{
  "freq": "15min",
  "h": 96,
  "series": { "sizes": [1344], "y": [257.39, 251.04] },
  "level": [80],
  "model": "timegpt-1",
  "clean_ex_first": true
}
```

响应关键字段：

- `mean`: P50 序列
- `intervals["80"]`: P10/P90（结构见 `src/clients/model.ts` 的 `parseIntervals`）

## 7. 什么不该进 prompt

- 96 个原始价格点 → 先压缩成小时均值 + 峰谷窗口
- 原始气象格点数据 → 先聚合成城市级特征
- 完整规则 PDF → 走 RAG 检索片段
- 用户 Token / 密钥 → 永不进上下文

## 8. 数据授权

- DE-LU / AT 日前价格：CC BY 4.0（Bundesnetzagentur | SMARD.de），可再分发，需署名。
- 其它 bidding zone：仅限私有/内部使用，商用/公开再分发需向数据提供方确认。
- Open-Meteo：CC BY 4.0，需署名。
- ENTSO-E：按其使用条款。