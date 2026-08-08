/**
 * 早报的日界一律按 UTC+8 计算——服务器跑在 UTC，若直接用 UTC 日期，
 * UTC+8 早上 8 点（UTC 00:00）出的稿在跨月/跨年时会挂到前一天，
 * slug 与文章日期对不上。
 */
const UTC_PLUS_8_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 返回 UTC+8 时区下的 YYYY-MM-DD */
export function utcPlus8DateString(nowMs: number): string {
  // 把时间轴整体平移 8 小时后按 UTC 取日期，等价于在 UTC+8 下取日期，
  // 且不依赖运行环境的本地时区（Vercel 是 UTC，本地开发可能不是）
  return new Date(nowMs + UTC_PLUS_8_OFFSET_MS).toISOString().slice(0, 10);
}

/** 返回 UTC+8 时区下的小时（0-23）。用于早报的发布时间窗闸门 */
export function utcPlus8Hour(nowMs: number): number {
  return new Date(nowMs + UTC_PLUS_8_OFFSET_MS).getUTCHours();
}

/** 文章 slug。articles.slug 有 UNIQUE 约束，这也是本功能的幂等闸门 */
export function briefingSlug(dateStr: string): string {
  return `daily-briefing-${dateStr}`;
}

/** 素材窗口起点：当前时刻回退 24 小时 */
export function windowStart24h(nowMs: number): number {
  return nowMs - 24 * 60 * 60 * 1000;
}
