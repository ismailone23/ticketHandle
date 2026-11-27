// In-process cache for hot reads: a hit is a Map lookup, and concurrent misses share one fetch.
// shortcut: per worker process and not invalidated on writes, so keep TTLs to a few seconds.
const store = new Map<string, Promise<unknown>>();

export const memo = <T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
  const hit = store.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = fn();
  store.set(key, p);
  p.then(
    () => setTimeout(() => store.delete(key), ttlMs),
    () => store.delete(key), // never cache a failure
  );
  return p;
};

export const forget = (key: string) => store.delete(key);
