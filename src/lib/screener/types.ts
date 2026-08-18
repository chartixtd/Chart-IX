import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/limits";

export type Direction = "long" | "short";

/**
 * 扫描间隔 15 分钟。触发器（pg_cron / GitHub Actions）打得比这更密，
 * 由服务端按这个数门控——「漏掉的一轮由下一轮补上」，
 * 与早报和榜单推送是同一条原则。
 */
export const SCAN_INTERVAL_MS = 900_000;

/** 总分达到这个数触发警报 */
export const ALERT_TRIGGER_SCORE = 80;

/**
 * 警报关闭线。刻意低于触发线：80 分线上的抖动会让一个币在几十分钟内
 * 反复开关警报、反复推送。这段迟滞区间是必需的，不是可选优化。
 */
export const ALERT_CLOSE_SCORE = 75;

/** 连续多少次扫描低于关闭线才真的关闭警报（约 45 分钟） */
export const ALERT_CLOSE_STREAK = 3;

/** 批量层调用数：liquidation/coin-list + funding-rate/exchange-list，两次固定调用。 */
const BATCH_LAYER_CALLS = 2;

/**
 * 明细层每个币要打的调用数：pairs-markets + open-interest/aggregated-history +
 * price/history + taker-buy-sell-volume/history + liquidation/history。
 * T20 把 open-interest 那一路从快照端点（exchange-list）换成了序列端点
 * （aggregated-history，OI 因子要在序列上做背离判断），调用次数没变，仍是 1 次。
 */
const DETAIL_CALLS_PER_COIN = 5;

/**
 * 一轮扫描进入明细层的币数上限，由 `RATE_LIMIT_PER_MIN` **推导**而不是写死的整数。
 *
 * T19 第一版直接写死 15：`2 + 15 × 5 = 77`，看着卡在 CoinGlass 文档写的
 * `API-KEY-MAX-LIMIT: 80`（每分钟）以内，但忘了限流器自己留了 5 次余量、
 * 真正生效的窗口是 `RATE_LIMIT_PER_MIN = 75`，`77 > 75`——真实 dryrun 里
 * 最后两次调用撞上限流器，等了将近一整个滚动窗口才放行，60.7 秒撞破
 * Vercel Hobby 的 60 秒函数上限。
 *
 * `DEEP_SCAN_LIMIT` 与 `RATE_LIMIT_PER_MIN` 是绑死的一对数：必须满足
 * `BATCH_LAYER_CALLS + DETAIL_CALLS_PER_COIN × DEEP_SCAN_LIMIT ≤ RATE_LIMIT_PER_MIN`，
 * 改任何一边都要重新满足这条不等式，光靠注释提醒守不住这种「两个常量必须配套」
 * 的约束（上一次翻车就是注释写对了、数字对不上）。所以这里不再写死数字，
 * 而是从 `RATE_LIMIT_PER_MIN` 用 `Math.floor` 反推——只要限流器的配额常量改了，
 * 这个上限会跟着自动重算，不可能再出现两处数字互相矛盾的情况。
 * `types.test.ts` 用一条断言把这条不等式钉死，防止未来有人绕开这个推导式
 * 直接把 `DEEP_SCAN_LIMIT` 改回一个写死的数字。
 */
export const DEEP_SCAN_LIMIT = Math.floor((RATE_LIMIT_PER_MIN - BATCH_LAYER_CALLS) / DETAIL_CALLS_PER_COIN);

export const FACTOR_MAX = {
  zone: 30,
  sweep: 20,
  oi: 30,
  cvd: 20,
} as const;

export interface FactorBreakdown {
  zone: number;
  sweep: number;
  oi: number;
  cvd: number;
}

export interface ScannerRow {
  /** BingX 永续 symbol，如 "TIA-USDT"。下单链接与警报表都用它当主键。 */
  symbol: string;
  /** CoinGlass 币种名，如 "TIA"。剥掉了 -USDT 与合约乘数前缀。 */
  coin: string;
  direction: Direction;
  /** 0–100，等于 factors 四项之和（已取整） */
  total: number;
  factors: FactorBreakdown;
  /**
   * price / change24h / amplitude / volumeUsd 这四个字段口径故意不同，
   * 各自回答不同的问题：
   *   · price 与 change24h 取 CoinGlass pairs-markets 里 BingX 那一行，
   *     两者必须同源——用户在哪儿下单就该看哪儿的价和涨跌，不能显示的价格
   *     来自 BingX、涨跌却来自另一个市场。pairs-markets 也没有像
   *     open-interest/exchange-list 那样的 "All" 聚合行，"全交易所涨跌"
   *     这个东西本来就拿不到。
   *   · amplitude 取 history 交易所（默认 Binance）的 30m K 线，
   *     因为振幅要连续的价格序列，只有拉了 K 线的那一家才有。
   *   · volumeUsd 是全交易所 volume_usd 求和，因为流动性门槛问的是
   *     「这个币好不好进出」，那是全市场属性，不该只看下单那一家。
   */
  price: number;
  /** BingX 那一行的 24h 涨跌 %，与 price 同源（见上方 price 的注释） */
  change24h: number | null;
  /** 30m K 线算的真 24h 振幅 %，取自 history 交易所（见上方 price 的注释） */
  amplitude: number;
  /** CoinGlass 全交易所 volume_usd 之和（见上方 price 的注释） */
  volumeUsd: number;
  marketCap: number;
  marketCapRank: number;
  /** BingX 那一行的资金费率；缺失时是全交易所中位数；都拿不到为 null */
  fundingRate: number | null;
  /** K 线/CVD 实际取自哪个交易所，供前端标注数据来源 */
  sourceExchange: string;
}

export interface ScannerPayload {
  rows: ScannerRow[];
  /** 这份结果的计算时间，ms epoch —— 前端用它算倒计时 */
  computedAt: number;
}
