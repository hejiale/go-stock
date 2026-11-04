// 时区工具：把绝对时间格式化成年月日 + 偏移，避免把 UTC 当本地。

/** 在指定 IANA 时区格式化，输出 2026-11-05T00:00:00+01:00 形式。 */
export function formatInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  const minute = get("minute");
  const second = get("second");

  // 用“本地墙上时间当作 UTC”与真实时间求差，得到偏移
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const offsetMin = Math.round((asUtc - date.getTime()) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${String(
    Math.floor(abs / 60)
  ).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600_000);
}

/** YYYY-MM-DD（按指定时区）。 */
export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 今天（指定时区）的 YYYY-MM-DD。 */
export function todayInZone(timeZone: string): string {
  return dateInZone(new Date(), timeZone);
}

/** 把“某时区的墙上时间”转成绝对时间，例如 2026-11-05 + 22:00 + Europe/London。 */
export function zonedWallTimeToDate(dateStr: string, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const pad = (n: number) => String(n).padStart(2, "0");
  let guess = new Date(`${dateStr}T${pad(h ?? 0)}:${pad(m ?? 0)}:00Z`);
  for (let i = 0; i < 2; i++) {
    const off = parseOffsetMinutes(formatInZone(guess, timeZone));
    guess = new Date(guess.getTime() - off * 60_000);
  }
  return guess;
}

/** 指定时区的小时（0-23）。 */
export function hourInZone(date: Date | string, timeZone: string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return Number(h) % 24;
}

/** 是否是合法的 YYYY-MM-DD。 */
export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

/** 从 YYYY-MM-DD 得到该时区当天 00:00 的绝对时间（依赖运行时区偏移）。 */
export function dayStartInZone(dateStr: string, timeZone: string): Date {
  // 先按 UTC 零点，再用该时刻在目标时区的偏移修正一次
  let guess = new Date(`${dateStr}T00:00:00Z`);
  for (let i = 0; i < 2; i++) {
    const formatted = formatInZone(guess, timeZone);
    const offset = parseOffsetMinutes(formatted);
    guess = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - offset * 60_000);
  }
  return guess;
}

function parseOffsetMinutes(iso: string): number {
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}