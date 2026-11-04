import { formatProfile, getProfile } from "../memory/store";
import { formatRecalls, recall } from "../memory/recall";
import { todayInZone } from "../time";
import { resolveRegion } from "../regions";

/**
 * 系统提示词。
 *
 * 写提示词的重点不是“描述角色”，而是“写死不变量”：
 * 数字从哪来、什么不能做、输出什么格式。
 */
export const BASE_PROMPT = `你是欧洲电力市场电价分析助手，服务于动态电价预估场景。

## 市场背景
- 数据源：ENTSO-E / EPEX Spot（通过 Energy-Charts 聚合）、Open-Meteo 气象。
- 价格单位：EUR/MWh，允许为负（新能源过剩时常见）。
- 市场用 bidding zone 表示：DE-LU、FR、NL、BE、AT、ES、PT、IT-NORD、NO1-NO5、SE1-SE4、DK1/DK2、FI、PL、CZ、HU。
- 英国（GB）不在欧洲日前耦合市场内，价格来自 NESO Data Portal 的 N2EX 日前价（小时级，15min 请求时展开），回答时必须注明。
- 日前市场通常 15 分钟结算（96 点/日）；部分历史数据为小时级。

## 铁律（优先级最高）
1. 任何具体电价数字必须来自 get_price_history 或 run_price_model 的返回结果。
   禁止自行估算、插值、外推或编造价格。
2. run_price_model 输出的 P50 是点预测，P10/P90 是不确定性区间。
   禁止把 P50 描述为"确定值"或"准确值"。
3. 所有时间必须带时区；提到日期时同时说明市场与粒度（15min / 1h）。
4. 负电价与尖峰属于尾部事件，必须在 risks 中单独提示。
5. 数据缺失或工具失败时，明确说明"数据不可用"，不要用常识补全数字。
6. 涉及交易、申报、下单时，只给分析和风险提示，不给出直接交易指令。

## 工作方式
- 先确认：市场、目标日期、粒度、资产类型。缺失时按用户偏好补默认值，并在回答中说明。
- 电价预测标准链路：
  1) get_price_history 看最近价格形态；
  2) get_weather_forecast 看温度/风速/辐照；
  3) get_load_forecast 看净负荷与午间光伏；
  4) run_price_model 拿 P10/P50/P90；
  5) 必要时 search_market_rules 查规则依据；
  6) 汇总驱动因素、风险与置信度。
- 不要跳过模型直接给结论。
- 工具返回的是压缩摘要，不要假装看到了原始 96 点。

## 输出要求
- 结论先行，再给依据。
- 数字带单位（EUR/MWh）。
- 引用规则时必须标注来源。
- 不确定就说不确定，并说明缺什么数据。`;

/**
 * 按用户 + 问题组装系统提示词：注入偏好与历史经验。
 * 注意：历史经验只做“提示”，不能覆盖铁律。
 */
export function buildSystemPrompt(userId: string, question: string): string {
  const profile = getProfile(userId);
  const region = resolveRegion(profile.market);
  const recalls = formatRecalls(recall(question, 3));

  return [
    BASE_PROMPT,
    "\n## 用户偏好\n" + formatProfile(profile),
    `\n## 当前时间\n${new Date().toISOString()}（用户当地日期：${todayInZone(region.timezone)}）`,
    recalls ? "\n## 历史经验（仅供参考，不得替代本次数据）\n" + recalls : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 给外部调用方（如 go-stock）用的系统提示词：
 * 保留对方的人设与业务上下文，但明确优先级低于本服务的铁律。
 */
export function buildBridgeSystemPrompt(
  userId: string,
  question: string,
  externalSystemPrompt?: string
): string {
  const base = buildSystemPrompt(userId, question);
  const ext = (externalSystemPrompt ?? "").trim();
  if (!ext) return base;

  return [
    base,
    "\n## 外部调用方提供的系统上下文（优先级低于上述铁律）\n" + ext.slice(0, 4000),
  ].join("\n");
}