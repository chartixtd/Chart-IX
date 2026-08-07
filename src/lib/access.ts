/**
 * 权限模型的单一事实来源。
 *
 * 取代原先的 feature_flags 表 —— 那套机制有 7 个开关，但全项目只有一个
 * （advanced_chart）真的被读取，其余 6 个在后台改了不会影响任何行为。更糟的是
 * 它会误导：`futures_trading.free_enabled` 显示为 false，让人以为免费用户被这个
 * 开关挡住了，实际拦截来自下单路由里硬编码的 tier 判断；反过来想放开时，
 * 打开开关也不会有任何效果。
 *
 * 现在的规则简单到不需要配置：
 *   - Pro   —— 除后台管理外的全部功能
 *   - 免费  —— 只能访问 free 内容；交易只能用模拟账户，不能下实盘单
 *   - 后台  —— 由 role='admin' 决定，与 tier 无关（见 admin-auth.ts）
 *
 * 这里只放纯函数，服务端与客户端共用同一套判断，避免两边各写一份而逐渐分叉。
 */

export type UserTier = "free" | "pro";
/** 内容（视频/文章）自身的可见等级 */
export type ContentTier = "free" | "pro";

/** 是否能访问某条内容的正文/完整播放。免费内容人人可看，Pro 内容仅 Pro。 */
export function canViewContent(userTier: UserTier | null, contentTier: ContentTier): boolean {
  if (contentTier === "free") return true;
  return userTier === "pro";
}

/**
 * 是否能下实盘单（现货 / 合约 / OCO）。
 *
 * 免费用户一律走模拟账户 —— 这是免费与 Pro 之间最实质的分界，也是唯一会
 * 动用用户真实资金的能力，所以判断集中在这里，三个下单路由都用它。
 */
export function canTradeLive(userTier: UserTier | null): boolean {
  return userTier === "pro";
}

/** 模拟盘对所有登录用户开放 —— 它正是免费用户的交易入口。 */
export function canTradePaper(userTier: UserTier | null): boolean {
  return userTier !== null;
}

/** K 线的绘图工具与技术指标面板。 */
export function canUseAdvancedChart(userTier: UserTier | null): boolean {
  return userTier === "pro";
}

/** 视频下载。目前对所有等级关闭（播放器也设了 controlsList="nodownload"）。 */
export function canDownloadVideo(_userTier: UserTier | null): boolean {
  return false;
}
