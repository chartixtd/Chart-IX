/**
 * 限流。优先走 Postgres 共享固定窗口计数器（跨 Vercel serverless 实例生效，
 * 见 supabase/migrations/021_rate_limit_buckets.sql），DB 不可用时退回进程内
 * 内存滑动窗口兜底，保证下单接口本身不会因限流依赖挂掉而整体不可用。
 *
 * 内存实现只能拦住打到同一实例的请求，不是完整防护；真正的护栏始终是
 * src/lib/trading/limits.ts 的服务端限额校验（每日单数、单笔金额上限等）。
 */
import { createServiceClient } from "@/lib/supabase/service";

const hits = new Map<string, number[]>();

export function clearRateLimitState(): void {
  hits.clear();
}

function checkRateLimitInMemory(
  key: string,
  config: { windowMs: number; max: number },
  now: number
): { ok: boolean; retryAfterMs: number } {
  const cutoff = now - config.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= config.max) {
    // 被拒的请求不计入窗口，否则持续刷会把封锁无限延长
    hits.set(key, recent);
    // When window is empty (e.g. max <= 0), use windowMs as retry time
    const retryAfterMs = recent.length > 0
      ? recent[0] + config.windowMs - now
      : config.windowMs;
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}

export async function checkRateLimit(
  key: string,
  config: { windowMs: number; max: number },
  now: number = Date.now()
): Promise<{ ok: boolean; retryAfterMs: number }> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .rpc("rpc_check_rate_limit", {
        p_key: key,
        p_window_ms: config.windowMs,
        p_max: config.max,
      })
      .single<{ ok: boolean; retry_after_ms: number }>();

    if (error || !data) {
      throw error ?? new Error("rpc_check_rate_limit returned no data");
    }
    return { ok: data.ok, retryAfterMs: Number(data.retry_after_ms) };
  } catch (err) {
    // DB 打不通时不能让下单接口整体炸掉，退回内存限流兜底，
    // 并记录一下方便发现共享限流失效的情况。
    console.error("[rate-limit] falling back to in-memory limiter:", err);
    return checkRateLimitInMemory(key, config, now);
  }
}
