interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * 6.4 — in-memory TTL cache, scoped to one warm serverless instance. Reduces duplicate
 * Finnhub/Yahoo calls when the same symbol is requested repeatedly within a short window
 * (e.g. a demo, or several users looking at the same popular ticker). Not shared across
 * instances or cold starts — fine for this app's modest request volume.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = store.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value as T;
  }
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}
