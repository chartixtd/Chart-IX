/** 早报只出这两种语言——ms-MY 由文章详情页的回退链显示英文版 */
export type BriefingLocale = "zh-CN" | "en-US";

/** 一条早报素材新闻（比 NewsItem 少 lang/imageUrl，早报不需要） */
export interface BriefingSource {
  title: string;
  url: string;
  source: string;
  /** ms epoch */
  publishedAt: number;
  summary: string;
}

/** 一条行情事实。change24hPct 必须来自现货 ticker——合约 ticker 只有 ~3 分钟窗口 */
export interface MarketFact {
  /** 交易对，如 "BTC-USDT" */
  symbol: string;
  /** 展示名，如 "BTC" */
  label: string;
  lastPrice: number;
  change24hPct: number;
}

/** DeepSeek 必须返回的结构。字段缺失或为空由质量门槛拦截 */
export interface BriefingJson {
  title: string;
  summary: string;
  headlines: { topic: string; points: string[] }[];
  analysis: {
    overview: string;
    crypto: string;
    gold: string;
    watchlist: string[];
  };
}
