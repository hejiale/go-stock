// 极简 HTTP 客户端：超时 + 一次重试 + 统一错误信息。
// 生产环境建议换 undici / ky，并加限流与熔断。

export async function getJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: "POST",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * 重试：网络错误 / 429 / 5xx，指数退避。
 * 注意：Energy-Charts 对高频请求会返回 429，生产环境务必配合缓存。
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i === retries) break;
      const msg = String((err as Error)?.message ?? err);
      const retryable = /HTTP (429|5\d\d)/.test(msg) || /fetch failed|timeout|ECONN/i.test(msg);
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}