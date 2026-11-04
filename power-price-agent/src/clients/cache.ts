// 进程内 TTL 缓存：降低对 Energy-Charts / Open-Meteo 的请求频率。
// 生产环境建议换 Redis，并按市场+日期做 key。

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  // 简单清理，避免无限增长
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
  }
}

export function cacheKey(parts: Array<string | number>): string {
  return parts.join("|");
}