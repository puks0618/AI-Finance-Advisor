// 6.4 — shared 429 backoff for every external data call (Finnhub, Yahoo candles).
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= RETRY_DELAYS_MS.length) {
      return res;
    }
    const jitter = Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] + jitter));
  }
}
