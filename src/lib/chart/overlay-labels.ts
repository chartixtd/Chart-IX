/**
 * 画在 K 线图上的那几个字：进场线 / 强平线 / 止盈止损 / 成交箭头。
 *
 * 单独一个零依赖叶子模块，不是写在 useChartOverlay 里，原因有两个：
 *
 * ① **它曾经就是写死的中文。** `"进场 多 200x"`、`"强平"`、`"止盈"` 直接拼在
 *    builder 里，英文界面上照样画中文——图表是 canvas，页面上那套
 *    `useTranslations` 的组件级翻译根本进不到这里，只能由调用方把译好的字串
 *    传进去。
 * ② 拆出来才测得动：useChartOverlay 拖着 react-query / zustand / Toast，
 *    在 node 里跑不起来；这里只吃一个 `t` 函数，能直接拿三份 messages 验
 *    「每个语言都拼得出话」。
 */

/** 只要求 next-intl `useTranslations` 的最小形状——不依赖 next-intl 的类型 */
export type Translate = (key: string, values?: Record<string, string>) => string;

export interface OverlayLabels {
  entry: (side: "long" | "short", leverage: string | number) => string;
  liquidation: string;
  takeProfit: string;
  stopLoss: string;
  limitOrder: (side: string) => string;
  conditionalOrder: (side: string) => string;
  /** 模拟盘成交箭头：开多 / 平空 */
  positionMarker: (action: "open" | "close", side: "long" | "short", price: string | number) => string;
  /** 现货成交箭头：买 / 卖 */
  fillMarker: (side: "buy" | "sell", price: string | number) => string;
  unknownError: string;
}

/**
 * `t` 取自 `useTranslations("trade.chart")`。
 *
 * 多/空、开/平这些词不在这里拼字符串，一律走 messages——中文是「开多」不带
 * 空格、英文是「Open Long」带空格，拼接的写法必然有一边是错的。
 */
export function buildOverlayLabels(t: Translate): OverlayLabels {
  const sideWord = (side: "long" | "short") => t(side === "long" ? "side_long" : "side_short");
  return {
    entry: (side, leverage) => t("entry_line", { side: sideWord(side), leverage: String(leverage) }),
    liquidation: t("liq_line"),
    takeProfit: t("tp_line"),
    stopLoss: t("sl_line"),
    limitOrder: (side) => t("limit_line", { side }),
    conditionalOrder: (side) => t("conditional_line", { side }),
    positionMarker: (action, side, price) =>
      t(action === "open" ? "marker_open" : "marker_close", { side: sideWord(side), price: String(price) }),
    fillMarker: (side, price) => t(side === "buy" ? "marker_buy" : "marker_sell", { price: String(price) }),
    unknownError: t("unknown_error"),
  };
}
