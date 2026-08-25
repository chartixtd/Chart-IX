import { timingSafeEqual } from "crypto";
import { checkRateLimit } from "@/lib/trading/rate-limit";

/**
 * Cron 端点鉴权。
 *
 * 推送“一直不会自动推送”的根因：028 里的 pg_cron 注册 SQL 是带占位符的
 * 模板，从未在线上 Supabase 执行过，所以没有任何调度器在打这两个端点——
 * telegram_push_log 里只有 manual 记录，一条 cron 触发的都没有。
 *
 * 修复用 GitHub Actions 做外部调度器（见 .github/workflows/cron-tick.yml）。
 * 但仓库是公开的，没法安全地把 CRON_SECRET 交给工作流（它的值只在 Vercel
 * 控制台可见）。所以改成两级放行：
 *
 * 1. 带 CRON_SECRET 的请求（Vercel Cron 自动附带；pg_cron 手动配置）——
 *    直接放行，不限流。
 * 2. 匿名 tick —— 也放行，但走全站共享限流桶。tick 本身是安全的：每条 tick
 *    真正会做的事都自带收敛条件——早报补投只补今天那篇且成功过就不再发，
 *    扫描按 isScanDue 门控，警报推送要求「本轮真的有新卡片」。匿名放行的
 *    最坏情况是「功能按预期运行」，限流挡住的是刷量烧配额。
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type CronTickAuth =
  | { ok: true; via: "secret" | "public" }
  | { ok: false; status: 429; retryAfterMs: number };

export async function authorizeCronTick(
  authorizationHeader: string | null,
  jobName: string
): Promise<CronTickAuth> {
  const secret = process.env.CRON_SECRET;
  if (secret && authorizationHeader?.startsWith("Bearer ")) {
    const token = authorizationHeader.slice("Bearer ".length);
    if (safeEqual(token, secret)) return { ok: true, via: "secret" };
  }

  // 匿名 tick：全局桶（不按 IP —— 合法调度器与攻击者共享同一预算，
  // 预算本身就设在正常调度频率之上，所以合法 tick 永远够用）。
  const limit = await checkRateLimit(`cron-tick:${jobName}`, {
    windowMs: 60_000,
    max: 3,
  });
  if (!limit.ok) return { ok: false, status: 429, retryAfterMs: limit.retryAfterMs };
  return { ok: true, via: "public" };
}
