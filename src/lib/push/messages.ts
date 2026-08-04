/**
 * 通知文案在服务端按订阅行存的 locale 生成——推送在用户看不见页面时
 * 弹出，没法临时问客户端要语言。
 *
 * 这里不走 next-intl：它面向请求上下文，而 cron 里没有请求语言可言。
 */
type Locale = "zh-CN" | "en-US" | "ms-MY";

const COPY: Record<Locale, {
  alertTitle: (symbol: string) => string;
  alertAbove: (price: string) => string;
  alertBelow: (price: string) => string;
  screenerTitle: string;
  screenerBody: string;
  contentVideoTitle: string;
  contentArticleTitle: string;
}> = {
  "zh-CN": {
    alertTitle: (s) => `${s} 到价提醒`,
    alertAbove: (p) => `已涨破 ${p}`,
    alertBelow: (p) => `已跌破 ${p}`,
    screenerTitle: "新的选币榜单",
    screenerBody: "本轮筛选结果已更新，点击查看做多与做空候选。",
    contentVideoTitle: "新视频上线",
    contentArticleTitle: "新文章上线",
  },
  "en-US": {
    alertTitle: (s) => `${s} price alert`,
    alertAbove: (p) => `Broke above ${p}`,
    alertBelow: (p) => `Broke below ${p}`,
    screenerTitle: "New screener results",
    screenerBody: "This round's candidates are ready — tap to see long and short setups.",
    contentVideoTitle: "New video published",
    contentArticleTitle: "New article published",
  },
  "ms-MY": {
    alertTitle: (s) => `Amaran harga ${s}`,
    alertAbove: (p) => `Menembusi ke atas ${p}`,
    alertBelow: (p) => `Menembusi ke bawah ${p}`,
    screenerTitle: "Keputusan penapis baharu",
    screenerBody: "Calon pusingan ini sudah sedia — ketik untuk lihat setup panjang dan pendek.",
    contentVideoTitle: "Video baharu diterbitkan",
    contentArticleTitle: "Artikel baharu diterbitkan",
  },
};

function pick(locale: string) {
  return COPY[(locale as Locale) in COPY ? (locale as Locale) : "en-US"];
}

export function buildAlertMessage(
  locale: string,
  symbol: string,
  direction: "above" | "below",
  price: number
): { title: string; body: string } {
  const copy = pick(locale);
  const formatted = price.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return {
    title: copy.alertTitle(symbol),
    body: direction === "above" ? copy.alertAbove(formatted) : copy.alertBelow(formatted),
  };
}

export function buildScreenerMessage(locale: string): { title: string; body: string } {
  const copy = pick(locale);
  return { title: copy.screenerTitle, body: copy.screenerBody };
}

export function buildContentMessage(
  locale: string,
  kind: "video" | "article",
  title: string
): { title: string; body: string } {
  const copy = pick(locale);
  return {
    title: kind === "video" ? copy.contentVideoTitle : copy.contentArticleTitle,
    body: title,
  };
}
