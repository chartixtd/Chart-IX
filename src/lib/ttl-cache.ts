export interface TtlCacheOptions<T> {
  ttlMs: number;
  compute: () => Promise<T>;
  /** 注入时钟，方便测试 */
  now?: () => number;
}

export function createTtlCache<T>({ ttlMs, compute, now = Date.now }: TtlCacheOptions<T>) {
  let cached: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      if (cached && now() - cached.at < ttlMs) return cached.data;
      // 已有人在算就搭同一班车——冷缓存时 N 个并发请求只触发 1 次上游计算
      if (inflight) return inflight;

      inflight = compute().then(
        (data) => { cached = { at: now(), data }; inflight = null; return data; },
        (err) => {
          inflight = null;
          // 有旧结果就先顶着用（stale-while-error），别让一次上游抖动把整页打空
          if (cached) return cached.data;
          throw err;
        }
      );
      return inflight;
    },
    peek: () => cached,
  };
}
