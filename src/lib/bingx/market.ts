import { bingxClient } from "./client";
import type {
  BingXSymbol,
  BingXSpotSymbolsResponse,
  BingXTicker,
  BingXKlineRow,
  BingXKline,
  BingXDepth,
  BingXTrade,
  BingXContract,
  BingXOpenInterest,
  BingXFundingRate,
} from "@/types/bingx";

// ==================== 现货行情 ====================

/** 获取现货交易对列表。注意：BingX 把数组嵌在 data.symbols 里 */
export async function getSpotSymbols(symbol?: string): Promise<BingXSymbol[]> {
  const res = await bingxClient.publicRequest<BingXSpotSymbolsResponse>(
    "/openApi/spot/v1/common/symbols",
    { symbol }
  );
  return res.symbols ?? [];
}

/**
 * 获取24小时行情。
 *
 * 实测（2026-07-29）：带 symbol 查询单个交易对时，BingX 现货接口把 ticker
 * 包在一个长度为 1 的数组里（`data: [ {...} ]`），不是像合约 `/quote/ticker`
 * 那样直接返回对象；`bingxClient.publicRequest` 对此不做归一化，原样把
 * `json.data` 吐出去。旧实现直接把返回值断言成 `BingXTicker`，实际拿到的是
 * 数组，调用方读 `.lastPrice` 永远是 `undefined`。这里做与 `getSpotSymbols`
 * （`data.symbols` 嵌套）同类的拆包：数组取第一个元素，对象直接用，
 * 两者都拿不到时返回 null，调用方必须处理这个 null。
 */
export async function getSpotTicker(symbol: string): Promise<BingXTicker | null> {
  const res = await bingxClient.publicRequest<BingXTicker | BingXTicker[]>(
    "/openApi/spot/v1/ticker/24hr",
    { symbol }
  );
  if (Array.isArray(res)) return res[0] ?? null;
  return res ?? null;
}

/** 批量获取24小时行情 */
export async function getSpotTickers(): Promise<BingXTicker[]> {
  return bingxClient.publicRequest<BingXTicker[]>("/openApi/spot/v1/ticker/24hr");
}

/** 获取K线数据 */
export async function getSpotKlines(
  symbol: string,
  interval = "1h",
  limit = 100,
  startTime?: number,
  endTime?: number
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<BingXKlineRow[]>(
    "/openApi/spot/v1/market/kline",
    { symbol, interval, limit, startTime, endTime }
  );

  return rows.map((row) => ({
    openTime: row[0],
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    closeTime: row[6],
    quoteVolume: parseFloat(row[7]),
    trades: row[8],
  }));
}

/** 获取订单簿深度 */
export async function getSpotDepth(symbol: string, limit = 10): Promise<BingXDepth> {
  return bingxClient.publicRequest<BingXDepth>("/openApi/spot/v1/market/depth", {
    symbol,
    limit,
  });
}

/** BingX 现货成交接口的原始响应形状。实测（2026-08-08）：`id`/`price`/`qty`
 * 是 number 而不是 `BingXTrade` 声明的 string，方向字段是 `buyerMaker` 而不是
 * `isBuyerMaker`。旧实现把响应直接断言成 `BingXTrade[]`，从未真正映射过——
 * 这条 REST 路径以前是死代码，从没跑过，直接断言的假类型从未被发现。 */
interface RawBingXTrade {
  id: number | string;
  price: number | string;
  qty: number | string;
  time: number;
  buyerMaker: boolean;
}

/** 获取最新成交。响应按 time 降序（新到的在前），与 store/WS 的排序约定一致
 * （实测 2026-08-08：连续请求里 time 值递减），故不需要 reverse。 */
export async function getSpotTrades(symbol: string, limit = 20): Promise<BingXTrade[]> {
  const raw = await bingxClient.publicRequest<RawBingXTrade[]>("/openApi/spot/v1/market/trades", {
    symbol,
    limit,
  });
  return raw.map((t) => ({
    id: String(t.id),
    price: String(t.price),
    qty: String(t.qty),
    time: t.time,
    isBuyerMaker: t.buyerMaker,
  }));
}

// ==================== 合约行情 ====================

/** 获取合约列表 */
export async function getFuturesContracts(): Promise<BingXContract[]> {
  return bingxClient.publicRequest<BingXContract[]>("/openApi/swap/v2/quote/contracts");
}

/** 获取合约K线 */
export async function getFuturesKlines(
  symbol: string,
  interval = "1h",
  limit = 100,
  startTime?: number,
  endTime?: number
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<BingXKlineRow[]>(
    "/openApi/swap/v3/quote/klines",
    { symbol, interval, limit, startTime, endTime }
  );

  return rows.map((row) => ({
    openTime: row[0],
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    closeTime: row[6],
    quoteVolume: parseFloat(row[7]),
    trades: row[8],
  }));
}

/** 获取合约24小时行情 */
export async function getFuturesTicker(symbol: string): Promise<BingXTicker> {
  return bingxClient.publicRequest<BingXTicker>("/openApi/swap/v2/quote/ticker", {
    symbol,
  });
}

/** 获取合约未平仓量 */
export async function getFuturesOpenInterest(symbol: string): Promise<BingXOpenInterest> {
  return bingxClient.publicRequest<BingXOpenInterest>("/openApi/swap/v2/quote/openInterest", {
    symbol,
  });
}

/** 获取合约溢价指数（含当前资金费率） */
export async function getFuturesFundingRate(symbol: string): Promise<BingXFundingRate> {
  return bingxClient.publicRequest<BingXFundingRate>("/openApi/swap/v2/quote/premiumIndex", {
    symbol,
  });
}

/** 批量获取合约24小时行情（不传 symbol 时 BingX 返回全部永续合约） */
export async function getFuturesTickers(): Promise<BingXTicker[]> {
  const res = await bingxClient.publicRequest<BingXTicker[]>("/openApi/swap/v2/quote/ticker");
  return Array.isArray(res) ? res : [];
}
