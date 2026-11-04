// 数据防泄漏 / 时间窗口守卫。
// 电价回测最容易犯的错：用“现在才有”的数据去预测历史。

/** 校验 ISO8601 且必须带时区（Z 或 ±HH:MM）。 */
export function assertIsoWithTz(value: string, field = "time"): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${field} 必须是带时区的 ISO8601，收到: ${value}`);
  }
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${field} 不是合法时间: ${value}`);
  }
}

/** 目标日期必须是 YYYY-MM-DD。 */
export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`targetDate 必须是 YYYY-MM-DD，收到: ${value}`);
  }
}

/** 把查询窗口右端夹到“现在”之前，避免工具被诱导查询未来数据。 */
export function clampWindow(endIso: string): string {
  assertIsoWithTz(endIso, "end");
  const now = Date.now();
  const end = new Date(endIso).getTime();
  return new Date(Math.min(end, now - 1000)).toISOString();
}

/** 校验数据截止时间不晚于“当前可用时点”。 */
export function assertNoLeakage(endIso: string, cutoffHours = 0): void {
  const end = new Date(endIso).getTime();
  const cutoff = Date.now() - cutoffHours * 3600_000;
  if (end > cutoff + 2000) {
    throw new Error(
      `数据窗口 ${endIso} 晚于可用截止时点（cutoff=${new Date(cutoff).toISOString()}），存在数据泄漏风险`
    );
  }
}

/**
 * 校验预测目标日：允许未来 14 天内，拒绝过去日期。
 * 历史回测必须走单独入口并使用当时快照。
 */
export function assertForecastTarget(targetDate: string, maxAheadDays = 14): void {
  assertDate(targetDate);
  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(Date.now() + maxAheadDays * 24 * 3600_000).toISOString().slice(0, 10);

  if (targetDate < today) {
    throw new Error(`targetDate ${targetDate} 已过去；历史回测请使用回测快照，不能直接用实时数据`);
  }
  if (targetDate > max) {
    throw new Error(`targetDate ${targetDate} 超出 ${maxAheadDays} 天预测窗口`);
  }
}