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
 * 学习 tab 是 hub，收编视频、文章与行业资讯；更多 tab 收编所有低频页面。
 */
const TAB_SEGMENTS: Record<TabKey, string[]> = {
  dashboard: ["dashboard"],
  // 行业资讯是学习性质的内容，归学习 hub；原先它和订单/设置挤在「更多」这个
  // 杂物抽屉里，学习 tab 反而找不到它
  learn: ["learn", "videos", "articles", "news"],
  trade: ["trade"],
  screener: ["screener"],
  more: ["more", "orders", "settings", "upgrade"],
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

// 语言首页与这 5 个 tab 落地页是导航终点，不是"进去的"页面——不显示返回。
// 注意这里只匹配 tab 落地页本身，它们的子路由（/more/alerts 之类）仍要显示。
const BACK_HIDDEN_SEGMENTS: string[] = ["dashboard", "learn", "trade", "screener", "more"];

/**
 * 手机顶部栏是否显示返回按钮。
 *
 * 路径解析沿用 resolveActiveTab 的约定：语言前缀必须与当前语言一致，
 * 容忍结尾斜杠。前缀不一致时返回 false——切换语言的过渡瞬间不该闪出返回键。
 */
export function shouldShowBackButton(pathname: string, locale: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== locale) return false;

  const first = segments[1];
  if (!first) return false; // 语言首页

  // 长度为 2 才是 tab 落地页本身；/more/alerts 这类子路由要显示返回
  if (segments.length === 2 && BACK_HIDDEN_SEGMENTS.includes(first)) return false;

  return true;
}

/**
 * 没有站内历史可退时（外部链接直入 / PWA 冷启动），返回按钮该跳去哪。
 *
 * 兜底是语言首页而不是 dashboard：公开页面（文章/视频/学习）的流量大头是
 * 未登录用户，dashboard 对他们是一堵登录墙。
 */
export function resolveBackTarget(pathname: string, locale: string): string {
  const home = `/${locale}`;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== locale) return home;

  const first = segments[1];
  const second = segments[2];
  if (!first) return home;

  switch (first) {
    // 有第二段 = 详情页，退回列表页；没有 = 列表页本身，退回 learn hub
    case "articles":
      return second ? `/${locale}/articles` : `/${locale}/learn`;
    case "videos":
      return second ? `/${locale}/videos` : `/${locale}/learn`;
    case "learn":
      return `/${locale}/learn`;
    case "community":
      return `/${locale}/articles?tab=community`;
    // 有第二段 = /settings/api-keys，退回设置；没有 = 设置本身，退回更多
    case "settings":
      return second ? `/${locale}/settings` : `/${locale}/more`;
    case "more":
      return `/${locale}/more`;
    // 资讯归学习 hub（见 TAB_SEGMENTS），退回时也该回 /learn 而不是 /more
    case "news":
      return `/${locale}/learn`;
    case "orders":
    case "upgrade":
      return `/${locale}/more`;
    default:
      return home;
  }
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
  // 资讯已移入「学习」；价格提醒与通知设置暂时隐藏（路由与页面都保留，
  // 想开回来把条目加回这里即可）
  const entries: MoreEntry[] = [
    { key: "orders", href: `/${locale}/orders` },
    { key: "settings", href: `/${locale}/settings` },
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
