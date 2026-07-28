import { bingxClient } from "./client";
import type {
  BingXSymbol,
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

/** 获取现货交易对列表 */
export async function getSpotSymbols(symbol?: string): Promise<BingXSymbol[]> {
  return bingxClient.publicRequest<BingXSymbol[]>("/openApi/spot/v1/common/symbols", {
    symbol,
  });
}

/** 获取24小时行情 */
export async function getSpotTicker(symbol: string): Promise<BingXTicker> {
  return bingxClient.publicRequest<BingXTicker>("/openApi/spot/v1/ticker/24hr", {
    symbol,
  });
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

/** 获取最新成交 */
export async function getSpotTrades(symbol: string, limit = 20): Promise<BingXTrade[]> {
  return bingxClient.publicRequest<BingXTrade[]>("/openApi/spot/v1/market/trades", {
    symbol,
    limit,
  });
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
  limit = 100
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<BingXKlineRow[]>(
    "/openApi/swap/v3/quote/klines",
    { symbol, interval, limit }
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
