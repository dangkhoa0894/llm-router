// In-memory sliding-window limiter, keyed per account. Good enough for a
// single instance; swap for Redis before running several replicas.
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

export function tryConsume(key: string, limitPerMinute: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limitPerMinute) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function resetRateLimits() {
  hits.clear();
}
