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
  /** BingX 的成交价——用户在哪儿下单就显示哪儿的价 */
  price: number;
  /** CoinGlass 全交易所 24h 涨跌 % */
  change24h: number | null;
  /** 30m K 线算的真 24h 振幅 % */
  amplitude: number;
  /** CoinGlass volume_usd（真实值，不是 BingX 被拍平的 quoteVolume） */
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
