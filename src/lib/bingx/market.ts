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

/** 合约 v3 K线接口一根蜡烛的时长，用于补算现货式的 closeTime（见下方说明） */
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000, "1M": 2_592_000_000,
};

/**
 * `/openApi/swap/v3/quote/klines` 实测（2026-08-08）响应形状：一个对象数组
 * `{open,high,low,close,volume,time}`，跟现货 v1 K线接口的元组数组
 * （`BingXKlineRow`，`[openTime, open, high, low, close, volume, closeTime, ...]`）
 * 完全不是一回事。旧实现直接把响应断言成 `BingXKlineRow[]` 按下标取值，
 * `row[1]` 在对象上永远是 `undefined`，`parseFloat(undefined)` = NaN——
 * 合约图表从未真正渲染过数据，全是 NaN 蜡烛。这条路径此前只有 K 线走会触发，
 * 现货/合约用同一个 symbol 时视觉上还凑合能看（因为图表兜底），一直没被发现。
 */
interface RawFuturesKline {
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  time: number;
}

/** 获取合约K线 */
export async function getFuturesKlines(
  symbol: string,
  interval = "1h",
  limit = 100,
  startTime?: number,
  endTime?: number
): Promise<BingXKline[]> {
  const rows = await bingxClient.publicRequest<RawFuturesKline[]>(
    "/openApi/swap/v3/quote/klines",
    { symbol, interval, limit, startTime, endTime }
  );
  const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;

  return rows.map((row) => {
    const close = parseFloat(row.close);
    const volume = parseFloat(row.volume);
    return {
      openTime: row.time,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close,
      volume,
      // 接口本身不给收盘时间/USDT计价量（不像现货）；这两个字段在下游
      // （useKlineHistory/KlineChart）从未被实际读取，只是类型里带着，
      // 用区间估算填充即可，不影响图表渲染。
      closeTime: row.time + intervalMs - 1,
      quoteVolume: volume * close,
    };
  });
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

/** 获取合约订单簿深度。响应比现货多几个字段（T/bidsCoin/asksCoin），
 * 结构性兼容 BingXDepth，多余字段直接被类型忽略。 */
// 实测（2026-08-08）：合约深度接口的 limit 只接受这个固定枚举
// （"len=0|oneof=5 10 20 50 100 500 1000"），不像现货深度可以传任意 1-100 的值。
// UI 侧请求的 limit（如 OrderBook 用的 8）传进去会被 BingX 直接 400，这里向上
// 取整到最近的合法档位——调用方本来就会自己 slice 到想要的行数，多要几档无害。
const FUTURES_DEPTH_LIMITS = [5, 10, 20, 50, 100, 500, 1000];

export async function getFuturesDepth(symbol: string, limit = 10): Promise<BingXDepth> {
  const validLimit = FUTURES_DEPTH_LIMITS.find((l) => l >= limit) ?? 1000;
  return bingxClient.publicRequest<BingXDepth>("/openApi/swap/v2/quote/depth", {
    symbol,
    limit: validLimit,
  });
}

/** BingX 合约成交接口的原始响应形状。实测（2026-08-08）：没有 `id` 字段，
 * 用 `fillId` 代替；`price`/`qty` 已经是 string（与现货 RawBingXTrade 的
 * number 不同，无需额外转换）。 */
interface RawFuturesTrade {
  time: number;
  isBuyerMaker: boolean;
  price: string;
  qty: string;
  fillId: string;
}

/** 获取合约最新成交 */
export async function getFuturesTrades(symbol: string, limit = 20): Promise<BingXTrade[]> {
  const raw = await bingxClient.publicRequest<RawFuturesTrade[]>("/openApi/swap/v2/quote/trades", {
    symbol,
    limit,
  });
  return raw.map((t) => ({
    id: t.fillId,
    price: t.price,
    qty: t.qty,
    time: t.time,
    isBuyerMaker: t.isBuyerMaker,
  }));
}
