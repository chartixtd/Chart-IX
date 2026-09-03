import type { AlertCardData } from "@/lib/screener/cards";
import {
  scenarioLabel,
  scenarioAction,
  IGNITION_LABELS,
  fmtTriggerPrice,
  pickAlertLang,
} from "@/lib/screener/alert-copy";

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
  screenerCount: (n: number) => string;
  /** listed = 已列出的币种串，shown = 列了几个，total = 一共几个 */
  andMore: (listed: string, shown: number, total: number) => string;
  testTitle: string;
  testBody: string;
  contentVideoTitle: string;
  contentArticleTitle: string;
}> = {
  "zh-CN": {
    alertTitle: (s) => `${s} 到价提醒`,
    alertAbove: (p) => `已涨破 ${p}`,
    alertBelow: (p) => `已跌破 ${p}`,
    screenerCount: (n) => `${n} 个新信号`,
    andMore: (listed, _shown, total) => `${listed} 等 ${total} 个`,
    testTitle: "Chart-IX 测试通知",
    testBody: "推送通道正常，你会在这里收到扫描器警报。",
    contentVideoTitle: "新视频上线",
    contentArticleTitle: "新文章上线",
  },
  "en-US": {
    alertTitle: (s) => `${s} price alert`,
    alertAbove: (p) => `Broke above ${p}`,
    alertBelow: (p) => `Broke below ${p}`,
    screenerCount: (n) => `${n} new signal${n === 1 ? "" : "s"}`,
    andMore: (listed, shown, total) => `${listed} and ${total - shown} more`,
    testTitle: "Chart-IX test notification",
    testBody: "Push is working — scanner alerts will arrive here.",
    contentVideoTitle: "New video published",
    contentArticleTitle: "New article published",
  },
  "ms-MY": {
    alertTitle: (s) => `Amaran harga ${s}`,
    alertAbove: (p) => `Menembusi ke atas ${p}`,
    alertBelow: (p) => `Menembusi ke bawah ${p}`,
    screenerCount: (n) => `${n} isyarat baharu`,
    andMore: (listed, shown, total) => `${listed} dan ${total - shown} lagi`,
    testTitle: "Pemberitahuan ujian Chart-IX",
    testBody: "Tolakan berfungsi — amaran penapis akan tiba di sini.",
    contentVideoTitle: "Video baharu diterbitkan",
    contentArticleTitle: "Artikel baharu diterbitkan",
  },
};

/**
 * 必须用 hasOwnProperty 而不是 `in`：`in` 走原型链，于是
 * `"toString" in COPY === true`、`"valueOf" in COPY === true`，
 * pick("toString") 会返回 Function.prototype.toString，紧接着
 * `copy.alertTitle(...)` 就是一个 TypeError——推送整轮炸掉。
 *
 * locale 现在在 subscribe 路由已经是 z.enum 白名单了，这里是纵深防御：
 * 挡的是白名单落地**之前**已经写进 DB 的脏值，那些行谁也不会去回补。
 */
function pick(locale: string) {
  return Object.prototype.hasOwnProperty.call(COPY, locale)
    ? COPY[locale as Locale]
    : COPY["en-US"];
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

/**
 * 通知正文里最多列几个币种。
 *
 * 系统通知的正文在锁屏上只有一两行，列到第六个就已经被截断成省略号——
 * 那时候用户既看不全币种、也看不到「一共几个」。折起来是为了把后半句留出来。
 */
const MAX_LISTED_COINS = 5;

/**
 * 一轮扫描的全部新警报卡合成**一条**通知。
 *
 * 只有一张卡时说具体的事（哪个币、什么结构、该怎么办）——那是这条通知全部的
 * 价值所在。多张时退回汇总：一次剧烈行情能同时触发十几个币，逐张弹通知会把
 * 安卓的通知栏刷爆、在 iOS 上折成一堆，而且没有哪一条是重点。这跟 Telegram
 * 侧「多条合并成一条」是同一个判断（见 alert-push.ts 的 formatAlertMessage）。
 *
 * 场景名与操作文案走 alert-copy 的两语表，框架文案（「N 个新信号」）走本文件的
 * 三语表。ms-MY 因此会拿到「马来语标题 + 英文场景名」——已知的不对称，与
 * Telegram 侧一致。
 *
 * cards 为空时调用点已经挡掉了（screener-scan 的 newCards.length > 0），
 * 这里不为它专门造一句文案，走汇总分支得到「0 个新信号」+ 空正文。
 */
export function buildScreenerAlertMessage(
  locale: string,
  cards: AlertCardData[]
): { title: string; body: string } {
  const copy = pick(locale);

  if (cards.length === 1) {
    const card = cards[0];
    const lang = pickAlertLang(locale);
    // 直接在 trigger 上分支，不抽成布尔量——抽出来 TypeScript 就不再收窄
    // 这个联合类型，两支都会去访问对方没有的字段。
    const tr = card.trigger;
    const name =
      tr.type === "scenario"
        ? scenarioLabel(lang, tr.scenario)
        : IGNITION_LABELS[lang][tr.ignition.direction];
    const action =
      tr.type === "scenario"
        ? scenarioAction(lang, tr.scenario)
        : IGNITION_LABELS[lang].action;
    return {
      title: `🚨 ${card.coin} ${name}`,
      body: `@${fmtTriggerPrice(card.firstPrice)} · ${action}`,
    };
  }

  const coins = cards.map((c) => c.coin);
  const shown = coins.slice(0, MAX_LISTED_COINS);
  const listed = shown.join(" · ");
  return {
    title: `🚨 ${copy.screenerCount(coins.length)}`,
    body:
      coins.length > MAX_LISTED_COINS
        ? copy.andMore(listed, shown.length, coins.length)
        : listed,
  };
}

/** 「发送测试通知」按钮推的那条。它的全部作用是证明四段链路都通。 */
export function buildTestMessage(locale: string): { title: string; body: string } {
  const copy = pick(locale);
  return { title: copy.testTitle, body: copy.testBody };
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
