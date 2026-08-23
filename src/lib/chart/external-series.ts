/**
 * 图表「外部序列」的纯函数层：CoinGlass 的聚合持仓量（OI）与聚合 CVD
 * 怎么变成能挂在 K 线时间轴上的蜡烛。
 *
 * 这个文件是**客户端与服务端共用**的叶子模块，只允许 import 同样纯的模块
 * （`kline-history` 的 intervalToMs）。拉取 CoinGlass 的代码（`coinglassGet`、
 * 限流器、`process.env.COINGLASS_API_KEY`）放在 `src/lib/coinglass/chart-series.ts`
 * 里，绝不能从这里 import——否则 KlineChart 会把那套只该在服务端存在的
 * HTTP 封装一起打进浏览器 bundle（同 `coinglass/limits.ts` 顶部注释里的那条教训）。
 *
 * 术语：
 *   - kind   「oi」/「cvd」——前端按 kind 向 /api/coinglass/series 要数据；
 *            注册表里的指标用 `requires: [kind]` 声明自己要哪些。
 *   - bar    服务端回给前端的压缩行，`t` 是**秒**（与 lightweight-charts 的
 *            UTCTimestamp 同单位；CoinGlass 原始是毫秒，服务端归一化时除以 1000）。
 *   - CandlePoint  对齐到图表某一根 K 线之后的一根蜡烛；对不上的位置是 null。
 */
import { intervalToMs } from "@/lib/chart/kline-history";

export type ExternalKind = "oi" | "cvd";
export const EXTERNAL_KINDS: readonly ExternalKind[] = ["oi", "cvd"];

export function isExternalKind(v: string): v is ExternalKind {
  return (EXTERNAL_KINDS as readonly string[]).includes(v);
}

/** 持仓量序列的一根（CoinGlass 本身就按 OHLC 给）。`t` 秒。 */
export interface ExternalOhlcBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** 主动买/卖成交额的一根，美元。`t` 秒。CVD 在前端由它累加合成。 */
export interface ExternalFlowBar {
  t: number;
  buy: number;
  sell: number;
}

export interface ExternalSeriesPayload {
  oi?: ExternalOhlcBar[];
  cvd?: ExternalFlowBar[];
}

export interface CandlePoint {
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleSeries = (CandlePoint | null)[];

/** 注册表 compute() 通过 `input.ext` 拿到的、已对齐到当前 K 线数组的序列。 */
export interface ExternalInput {
  oi?: CandleSeries;
  cvd?: CandleSeries;
}

/**
 * STARTUP 套餐允许的粒度白名单，来自服务端 403 响应体（见
 * `coinglass/price-history.ts`）。15m 及以下一律被拒，所以图表在这些周期下
 * 不发请求、指标留空并在图例上提示，而不是把 30m 的值前向填充成阶梯线——
 * 1m 图上那会退化成一条横线，占着副图没有信息量。
 */
export const EXTERNAL_SERIES_INTERVALS = [
  "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w",
] as const;

export function isExternalIntervalSupported(interval: string): boolean {
  return (EXTERNAL_SERIES_INTERVALS as readonly string[]).includes(interval);
}

/**
 * 每次向 CoinGlass 要多少根。图表首页是 300 根，再往左翻页会继续拉 BingX
 * 的历史；CoinGlass 这边不跟着翻页（每翻一页就多一次上游调用，配额撑不住），
 * 固定拉 1000 根——30m 约 21 天、1h 约 41 天、1d 约 3 年——更早的部分留空。
 * 1000 也是 CoinGlass 文档里 history 端点的默认 limit，是最不可能被套餐
 * 限制拒绝的那个值。
 */
export const EXTERNAL_SERIES_LIMIT = 1000;

const TTL_MIN_MS = 5 * 60_000;
const TTL_MAX_MS = 4 * 60 * 60_000;

/**
 * 缓存/轮询周期。CoinGlass 配额是每分钟 75 次且与选币器共用（选币器每轮
 * 72 次、15 分钟一轮），图表这边每个 (kind, coin, interval) 组合在 TTL 内
 * 至多打一次上游。取「周期的 1/6，夹在 5 分钟到 4 小时之间」：
 *   30m → 5 分钟（最新那根蜡烛最多滞后 5 分钟）
 *   1h  → 10 分钟，4h → 40 分钟，1d/1w → 4 小时
 * 服务端缓存与客户端 react-query 的 staleTime/refetchInterval 共用这一个数。
 */
export function externalSeriesTtlMs(interval: string): number {
  const sixth = intervalToMs(interval) / 6;
  return Math.min(TTL_MAX_MS, Math.max(TTL_MIN_MS, sixth));
}

/** 币种名只允许大写字母数字——它会被原样拼进 CoinGlass 的查询串。 */
export function isValidExternalCoin(coin: string): boolean {
  return /^[A-Z0-9]{1,20}$/.test(coin);
}

/**
 * 主动买卖量 → CVD 蜡烛。
 *
 * 从拉到的窗口第一根起累加，起点是 0：open 是上一根的累计值，close 是
 * 加上本根净买入之后的累计值，high/low 取两者的大小——没有真正的盘中
 * 高低点（那需要逐笔数据），所以合成出来的是**无影线**蜡烛。
 *
 * 纵向偏移量因此是「窗口起点」决定的：窗口向前滑一根，整条序列会整体
 * 平移掉滑出去那根的净值。CoinGlass 网页版的 CVD 同样如此——CVD 只有
 * 形状和相对变化有意义，绝对值没有。
 */
export function cvdCandlesFromFlow(bars: ExternalFlowBar[]): ExternalOhlcBar[] {
  const out: ExternalOhlcBar[] = [];
  let cum = 0;
  for (const b of bars) {
    if (!Number.isFinite(b.buy) || !Number.isFinite(b.sell)) continue;
    const open = cum;
    cum += b.buy - b.sell;
    out.push({ t: b.t, o: open, h: Math.max(open, cum), l: Math.min(open, cum), c: cum });
  }
  return out;
}

/**
 * 把 OHLC 序列按「同一开盘时刻」对到图表的 K 线数组上。
 *
 * 只做精确匹配：CoinGlass 与 BingX 的 K 线都按 UTC 整周期开盘，同周期下
 * 时间戳应当逐根相等；对不上的根（更早的历史、CoinGlass 缺的根、刚开的
 * 新根还没刷到）给 null，图表上就是空位，不做插值。
 */
export function alignOhlcToTimes(bars: ExternalOhlcBar[], timesSec: ArrayLike<number>): CandleSeries {
  const byTime = new Map<number, ExternalOhlcBar>();
  for (const b of bars) byTime.set(b.t, b);
  const out: CandleSeries = new Array(timesSec.length);
  for (let i = 0; i < timesSec.length; i++) {
    const b = byTime.get(timesSec[i]);
    out[i] =
      b && Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c)
        ? { open: b.o, high: b.h, low: b.l, close: b.c }
        : null;
  }
  return out;
}

/** 服务端 payload → 注册表要的 `input.ext`。没拉到的 kind 不出现在结果里。 */
export function buildExternalInput(
  payload: ExternalSeriesPayload,
  timesSec: ArrayLike<number>
): ExternalInput {
  const ext: ExternalInput = {};
  if (payload.oi) ext.oi = alignOhlcToTimes(payload.oi, timesSec);
  if (payload.cvd) ext.cvd = alignOhlcToTimes(cvdCandlesFromFlow(payload.cvd), timesSec);
  return ext;
}

/** 没有外部数据时 compute() 的占位输出：与 K 线等长、全 null。 */
export function emptyCandles(length: number): CandleSeries {
  return new Array(length).fill(null);
}

export function isCandlePoint(v: unknown): v is CandlePoint {
  return typeof v === "object" && v !== null && "open" in v && "close" in v;
}
