/**
 * 进程内滑动窗口限流。
 *
 * 局限：Vercel serverless 会横向扩出多个实例，各自持有独立内存，
 * 因此这里只能拦住打到同一实例的暴力请求，不是完整防护。
 * 真正的护栏是 src/lib/trading/limits.ts 的服务端限额校验。
 * 若日后需要跨实例限流，需引入 Upstash Redis 之类的共享存储。
 */
const hits = new Map<string, number[]>();

export function clearRateLimitState(): void {
  hits.clear();
}

export function checkRateLimit(
  key: string,
  config: { windowMs: number; max: number },
  now: number = Date.now()
): { ok: boolean; retryAfterMs: number } {
  const cutoff = now - config.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= config.max) {
    // 被拒的请求不计入窗口，否则持续刷会把封锁无限延长
    hits.set(key, recent);
    const retryAfterMs = recent[0] + config.windowMs - now;
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}
