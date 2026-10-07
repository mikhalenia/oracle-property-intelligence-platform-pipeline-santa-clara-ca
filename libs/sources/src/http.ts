export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function fetchWithRetry(
  fetcher: Fetcher,
  url: string,
  init?: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url, {
        ...init,
        headers: { "user-agent": "scc-pipeline/0.1", ...(init?.headers ?? {}) },
      });
      if (res.ok) return res;
      lastError = new HttpStatusError(res.status, url);
      if (!RETRYABLE.has(res.status)) throw lastError;
    } catch (err) {
      lastError = err;
      if (err instanceof HttpStatusError && !RETRYABLE.has(err.status)) throw err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, base * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Retries the whole unit of request plus body read, so truncated bodies are retried too. */
export async function fetchAndRead<T>(
  fetcher: Fetcher,
  url: string,
  read: (res: Response) => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const init = opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : undefined;
      const res = await fetchWithRetry(fetcher, url, init, { retries: 0 });
      return await read(res);
    } catch (err) {
      lastError = err;
      if (err instanceof HttpStatusError && !RETRYABLE.has(err.status)) throw err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, base * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
