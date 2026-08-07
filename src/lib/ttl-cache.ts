export interface TtlCacheOptions<T> {
  ttlMs: number;
  compute: () => Promise<T>;
  /** 注入时钟，方便测试 */
  now?: () => number;
}

export function createTtlCache<T>({ ttlMs, compute, now = Date.now }: TtlCacheOptions<T>) {
  let cached: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  // 已有人在算就搭同一班车——无论冷缓存还是过期重算，N 个并发请求只触发 1 次上游计算
  function kick(): Promise<T> {
    if (!inflight) {
      inflight = compute().then(
        (data) => { cached = { at: now(), data }; inflight = null; return data; },
        (err) => {
          inflight = null;
          // 有旧结果就先顶着用（stale-while-error），别让一次上游抖动把整页打空
          if (cached) return cached.data;
          throw err;
        }
      );
    }
    return inflight;
  }

  return {
    async get(): Promise<T> {
      if (cached && now() - cached.at < ttlMs) return cached.data;
      if (cached) {
        // stale-while-revalidate：过期先还旧值，重算在后台进行，
        // 消灭“每小时一个用户在自己的请求里等全量重算”
        void kick().catch(() => {});
        return cached.data;
      }
      return kick(); // 冷缓存只能等
    },
    peek: () => cached,
  };
}
