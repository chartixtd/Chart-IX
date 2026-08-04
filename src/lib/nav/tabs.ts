export type TabKey = "dashboard" | "learn" | "trade" | "screener" | "more";

export interface MobileTab {
  key: TabKey;
  href: (locale: string) => string;
  /** 中央凸起的金色圆盘。它是目的地不是动作——点了直接跳转并显示选中态 */
  center: boolean;
}

export const MOBILE_TABS: MobileTab[] = [
  { key: "dashboard", href: (l) => `/${l}/dashboard`, center: false },
  { key: "learn", href: (l) => `/${l}/learn`, center: false },
  { key: "trade", href: (l) => `/${l}/trade`, center: true },
  { key: "screener", href: (l) => `/${l}/screener`, center: false },
  { key: "more", href: (l) => `/${l}/more`, center: false },
];

/**
 * 每个 tab 收编哪些一级路由段。
 * 学习 tab 是 hub，收编视频与文章；更多 tab 收编所有低频页面。
 */
const TAB_SEGMENTS: Record<TabKey, string[]> = {
  dashboard: ["dashboard"],
  learn: ["learn", "videos", "articles"],
  trade: ["trade"],
  screener: ["screener"],
  more: ["more", "news", "orders", "settings", "upgrade"],
};

export function resolveActiveTab(pathname: string, locale: string): TabKey | null {
  const segments = pathname.split("/").filter(Boolean);
  // 路径的语言前缀必须与当前语言一致，否则不做匹配——
  // 切换语言的过渡瞬间不该点亮错误的 tab
  if (segments[0] !== locale) return null;

  const first = segments[1];
  if (!first) return null;

  for (const [key, owned] of Object.entries(TAB_SEGMENTS) as [TabKey, string[]][]) {
    if (owned.includes(first)) return key;
  }
  return null;
}

export interface MoreEntry {
  key: string;
  href: string;
}

export function buildMoreEntries(input: {
  locale: string;
  tier: string | null;
  role: string | null;
}): MoreEntry[] {
  const { locale, tier, role } = input;
  const entries: MoreEntry[] = [
    { key: "news", href: `/${locale}/news` },
    { key: "orders", href: `/${locale}/orders` },
    { key: "alerts", href: `/${locale}/more/alerts` },
    { key: "settings", href: `/${locale}/settings` },
    { key: "notifications", href: `/${locale}/more/notifications` },
  ];

  // tier 为 null 表示 auth 还没加载完。此时不显示升级入口，
  // 避免 Pro 用户在加载窗口内看到升级链接闪一下（沿用 Navbar 的既有判断）
  if (tier !== null && tier !== "pro") {
    entries.push({ key: "upgrade", href: `/${locale}/upgrade` });
  }

  // 后台不做移动适配，这里只是个入口链接；它在 i18n 路由之外，不带语言前缀
  if (role === "admin") {
    entries.push({ key: "admin", href: "/admin" });
  }

  return entries;
}
