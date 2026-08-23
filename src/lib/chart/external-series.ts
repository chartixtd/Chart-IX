/**
 * 图表「外部序列」的纯函数层：CoinGlass 的聚合持仓量（OI）与聚合 CVD
 * 怎么变成能挂在 K 线时间轴上的蜡烛，以及一个指标实例的设置怎么变成
 * 一次向 CoinGlass 发的请求。
 *
 * 这个文件是**客户端与服务端共用**的叶子模块，只允许 import 同样纯的模块
 * （`kline-history` 的 intervalToMs、`market-cap` 的 stripContractMultiplier）。
 * 拉取 CoinGlass 的代码（`coinglassGet`、限流器、`process.env.COINGLASS_API_KEY`）
 * 放在 `src/lib/coinglass/chart-series.ts` 里，绝不能从这里 import——否则
 * KlineChart 会把那套只该在服务端存在的 HTTP 封装一起打进浏览器 bundle
 * （同 `coinglass/limits.ts` 顶部注释里的那条教训）。
 *
 * 术语：
 *   - kind     「oi」/「cvd」——注册表里的指标用 `requires: kind` 声明自己要哪一类。
 *   - request  一个指标实例的设置（市场/保证金类型/单位/交易所…）归一化后的
 *              请求描述；`externalRequestKey()` 是它的缓存键与去重键。
 *   - bar      服务端回给前端的压缩行，`t` 是**秒**（与 lightweight-charts 的
 *              UTCTimestamp 同单位；CoinGlass 原始是毫秒，服务端归一化时除以 1000）。
 *   - CandlePoint  对齐到图表某一根 K 线之后的一根蜡烛；对不上的位置是 null。
 */
import { intervalToMs } from "@/lib/chart/kline-history";
import { stripContractMultiplier } from "@/lib/market-cap";

export type ExternalKind = "oi" | "cvd";
export const EXTERNAL_KINDS: readonly ExternalKind[] = ["oi", "cvd"];

export function isExternalKind(v: string): v is ExternalKind {
  return (EXTERNAL_KINDS as readonly string[]).includes(v);
}

/** CVD 取现货还是合约的主动买卖量。 */
export type ExternalMarket = "spot" | "futures";
/** OI 的保证金类型。`all` 走不分保证金的聚合端点（那个端点不支持交易所筛选）。 */
export type ExternalMargin = "all" | "stablecoin" | "coin";
/** CoinGlass 的 `unit` 参数：美元计价还是币数量计价。 */
export type ExternalUnit = "usd" | "coin";

export const EXTERNAL_MARKETS: readonly ExternalMarket[] = ["spot", "futures"];
export const EXTERNAL_MARGINS: readonly ExternalMargin[] = ["all", "stablecoin", "coin"];
export const EXTERNAL_UNITS: readonly ExternalUnit[] = ["usd", "coin"];

/**
 * 一次向 CoinGlass 要序列的完整描述。同一个 request 只会打一次上游
 * （服务端缓存与前端 react-query 都按 `externalRequestKey` 去重）。
 *
 * `exchanges` 为 null = 「No Filter」：由服务端按端点套用默认交易所组合
 * （见 `coinglass/chart-series.ts` 的 DEFAULT_EXCHANGES）。
 */
export interface ExternalSeriesRequest {
  kind: ExternalKind;
  coin: string;
  interval: string;
  /** 只对 cvd 有意义；oi 固定 "futures" */
  market: ExternalMarket;
  /** 只对 oi 有意义；cvd 固定 "all" */
  margin: ExternalMargin;
  unit: ExternalUnit;
  exchanges: string[] | null;
}

/** 持仓量序列的一根（CoinGlass 本身就按 OHLC 给）。`t` 秒。 */
export interface ExternalOhlcBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** 主动买/卖成交额的一根（单位由 request.unit 决定）。`t` 秒。CVD 在前端由它累加合成。 */
export interface ExternalFlowBar {
  t: number;
  buy: number;
  sell: number;
}

export type ExternalSeriesBars = ExternalOhlcBar[] | ExternalFlowBar[];

/** 按 `externalRequestKey` 索引的已拉到序列。 */
export type ExternalSeriesPayload = Record<string, ExternalSeriesBars>;

export interface CandlePoint {
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleSeries = (CandlePoint | null)[];

/** 注册表 compute() 通过 `input.ext` 拿到的、已对齐到当前 K 线数组、属于**本实例**的序列。 */
export interface ExternalInput {
  series?: CandleSeries;
}

// ---------------------------------------------------------------------------
// 周期 / 配额
// ---------------------------------------------------------------------------

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
 * 1000 是 CoinGlass 文档里 history 端点的 limit 上限。
 */
export const EXTERNAL_SERIES_LIMIT = 1000;

const TTL_MIN_MS = 5 * 60_000;
const TTL_MAX_MS = 4 * 60 * 60_000;

/**
 * 缓存/轮询周期。CoinGlass 配额是每分钟 75 次且与选币器共用（选币器每轮
 * 72 次、15 分钟一轮），图表这边每个 request 在 TTL 内至多打一次上游。
 * 取「周期的 1/6，夹在 5 分钟到 4 小时之间」：
 *   30m → 5 分钟（最新那根蜡烛最多滞后 5 分钟）
 *   1h  → 10 分钟，4h → 40 分钟，1d/1w → 4 小时
 * 服务端缓存与客户端 react-query 的 staleTime/refetchInterval 共用这一个数。
 */
export function externalSeriesTtlMs(interval: string): number {
  const sixth = intervalToMs(interval) / 6;
  return Math.min(TTL_MAX_MS, Math.max(TTL_MIN_MS, sixth));
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 币种名只允许大写字母数字——它会被原样拼进 CoinGlass 的查询串。 */
export function isValidExternalCoin(coin: string): boolean {
  return /^[A-Z0-9]{1,20}$/.test(coin);
}

/** 交易所名：CoinGlass 的命名是字母数字加少量标点（"Crypto.com"、"Gate"）。 */
export function isValidExchangeName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,24}$/.test(name);
}

export const MAX_EXCHANGES = 20;

/**
 * 图表品种 → CoinGlass 币名。`BTC-USDT` / `BTC-USDC` → `BTC`，`1000PEPE-USDT` → `PEPE`
 * （与选币器 `coinFromBingXSymbol` 同一套规则，多覆盖一个 USDC 后缀——现货列表里有）。
 * 用户手填的自定义品种也走这里，所以顺手做大写与去空白。
 */
export function coinFromChartSymbol(symbol: string): string {
  return stripContractMultiplier(symbol.trim().toUpperCase()).replace(/-(USDT|USDC|USD)$/, "");
}

/** 逗号/空白分隔的交易所文本 → 去重、校验后的数组；空输入给 []。 */
export function parseExchangeList(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const name = raw.trim();
    if (!name || !isValidExchangeName(name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length >= MAX_EXCHANGES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 指标设置 → request
// ---------------------------------------------------------------------------

/**
 * 注册表里 CoinGlass 指标的设置键。值全是字符串或字符串数组（存在
 * `AppliedIndicator.settings`），这里只定义**含义**，控件渲染在 IndicatorModal。
 *
 *   symbolMode   "main" 跟随主图品种 / "custom" 用 `symbol`
 *   symbol       自定义币名或交易对（任何写法，经 coinFromChartSymbol 归一化）
 *   market       cvd：spot / futures
 *   margin       oi：all / stablecoin / coin
 *   unit         usd / coin
 *   exchangeMode "all"（No Filter，走端点默认组合）/ "custom"
 *   exchanges    自选交易所数组（勾选 + 手填合并后的结果）
 *   display      "candles" / "line"
 *   lineSource   折线模式取蜡烛的哪个值：open / high / low / close
 */
export type ExternalSettingValue = string | string[];
export type ExternalSettings = Record<string, ExternalSettingValue>;

function str(v: ExternalSettingValue | undefined, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function pick<T extends string>(v: ExternalSettingValue | undefined, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * 一个实例的设置 + 当前图表品种/周期 → request。
 * 返回 null 表示这个实例现在要不到数据（自定义品种为空/非法），调用方按「无数据」处理。
 */
export function buildExternalRequest(
  kind: ExternalKind,
  settings: ExternalSettings | undefined,
  chartSymbol: string,
  interval: string
): ExternalSeriesRequest | null {
  const s = settings ?? {};
  const symbolMode = pick(s.symbolMode, ["main", "custom"] as const, "main");
  const coin = coinFromChartSymbol(symbolMode === "custom" ? str(s.symbol, "") : chartSymbol);
  if (!isValidExternalCoin(coin)) return null;

  const exchangeMode = pick(s.exchangeMode, ["all", "custom"] as const, "all");
  const rawList = Array.isArray(s.exchanges) ? s.exchanges : [];
  const exchanges = exchangeMode === "custom" ? parseExchangeList(rawList.join(",")) : null;
  // 自选但一个都没选 = 退回 No Filter，而不是发一个空 exchange_list 让上游 400
  // CVD 默认合约：对齐 CoinGlass 那个「Aggregated Futures CVD (CVD Candles)」指标。
  const market = kind === "cvd" ? pick(s.market, EXTERNAL_MARKETS, "futures") : "futures";
  const margin = kind === "oi" ? pick(s.margin, EXTERNAL_MARGINS, "coin") : "all";

  return {
    kind,
    coin,
    interval,
    market,
    margin,
    unit: pick(s.unit, EXTERNAL_UNITS, "usd"),
    // 不分保证金的 OI 端点没有 exchange_list 参数，筛选在这里就没有意义
    exchanges: exchanges && exchanges.length && !(kind === "oi" && margin === "all") ? exchanges : null,
  };
}

/** 缓存键 / 去重键。交易所按不区分大小写排序，勾选顺序不同不算两个请求。 */
export function externalRequestKey(r: ExternalSeriesRequest): string {
  const ex = r.exchanges
    ? [...r.exchanges].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join("+")
    : "*";
  return `${r.kind}:${r.coin}:${r.interval}:${r.market}:${r.margin}:${r.unit}:${ex}`;
}

/** request → /api/coinglass/series 的查询串参数（不含 key 以外的任何东西）。 */
export function externalRequestToQuery(r: ExternalSeriesRequest): Record<string, string> {
  const q: Record<string, string> = {
    kind: r.kind,
    coin: r.coin,
    interval: r.interval,
    market: r.market,
    margin: r.margin,
    unit: r.unit,
  };
  if (r.exchanges) q.exchanges = r.exchanges.join(",");
  return q;
}

export type ParsedExternalQuery =
  | { ok: true; request: ExternalSeriesRequest }
  | { ok: false; code: string; message: string };

/**
 * 服务端入口的校验。每个字段都必须落在白名单里——它们最终会拼进发给
 * CoinGlass 的 URL，这里是唯一一道闸。
 */
export function parseExternalSeriesQuery(get: (name: string) => string | null): ParsedExternalQuery {
  const kind = get("kind") ?? "";
  if (!isExternalKind(kind)) return { ok: false, code: "BAD_KIND", message: "kind must be oi or cvd" };

  const coin = get("coin") ?? "";
  if (!isValidExternalCoin(coin)) {
    return { ok: false, code: "BAD_COIN", message: "coin must be an uppercase ticker" };
  }

  const interval = get("interval") ?? "";
  if (!isExternalIntervalSupported(interval)) {
    return { ok: false, code: "UNSUPPORTED_INTERVAL", message: "interval must be 30m or coarser" };
  }

  const marketRaw = get("market") ?? "futures";
  if (!(EXTERNAL_MARKETS as readonly string[]).includes(marketRaw)) {
    return { ok: false, code: "BAD_MARKET", message: "market must be spot or futures" };
  }
  const marginRaw = get("margin") ?? (kind === "oi" ? "coin" : "all");
  if (!(EXTERNAL_MARGINS as readonly string[]).includes(marginRaw)) {
    return { ok: false, code: "BAD_MARGIN", message: "margin must be all, stablecoin or coin" };
  }
  const unitRaw = get("unit") ?? "usd";
  if (!(EXTERNAL_UNITS as readonly string[]).includes(unitRaw)) {
    return { ok: false, code: "BAD_UNIT", message: "unit must be usd or coin" };
  }

  const exchangesRaw = get("exchanges");
  let exchanges: string[] | null = null;
  if (exchangesRaw !== null && exchangesRaw !== "") {
    const list = exchangesRaw.split(",");
    if (list.some((n) => !isValidExchangeName(n.trim()))) {
      return { ok: false, code: "BAD_EXCHANGE", message: "exchange names may only contain letters, digits, . _ -" };
    }
    exchanges = parseExchangeList(exchangesRaw);
    if (!exchanges.length) exchanges = null;
  }

  const market = (kind === "cvd" ? marketRaw : "futures") as ExternalMarket;
  const margin = (kind === "oi" ? marginRaw : "all") as ExternalMargin;
  return {
    ok: true,
    request: {
      kind,
      coin,
      interval,
      market,
      margin,
      unit: unitRaw as ExternalUnit,
      exchanges: kind === "oi" && margin === "all" ? null : exchanges,
    },
  };
}

// ---------------------------------------------------------------------------
// 交易所清单（给设置面板勾选用；手填框兜住清单之外的任何名字）
// ---------------------------------------------------------------------------

/** 名字必须与 CoinGlass `supported-exchange-pairs` 返回的拼写一致，大小写敏感。 */
export const FUTURES_EXCHANGE_CHOICES = [
  "Binance", "OKX", "Bybit", "Bitget", "Gate", "HTX", "KuCoin", "Hyperliquid",
  "Bitmex", "Deribit", "Kraken", "Coinbase", "Bitfinex", "MEXC", "CME",
] as const;

export const SPOT_EXCHANGE_CHOICES = [
  "Binance", "OKX", "Bybit", "Bitget", "Gate", "HTX", "KuCoin", "Coinbase",
  "Kraken", "Bitfinex", "MEXC",
] as const;

export function exchangeChoicesFor(kind: ExternalKind, market: ExternalMarket): readonly string[] {
  return kind === "cvd" && market === "spot" ? SPOT_EXCHANGE_CHOICES : FUTURES_EXCHANGE_CHOICES;
}

// ---------------------------------------------------------------------------
// 序列 → 蜡烛
// ---------------------------------------------------------------------------

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

export function isFlowBars(bars: ExternalSeriesBars): bars is ExternalFlowBar[] {
  return bars.length > 0 && "buy" in bars[0];
}

/** 一个 request 拉到的原始序列 → 对齐到 K 线数组的蜡烛。CVD 先累加再对齐。 */
export function candlesForRequest(
  kind: ExternalKind,
  bars: ExternalSeriesBars,
  timesSec: ArrayLike<number>
): CandleSeries {
  if (kind === "cvd") {
    return alignOhlcToTimes(isFlowBars(bars) ? cvdCandlesFromFlow(bars) : [], timesSec);
  }
  return alignOhlcToTimes(isFlowBars(bars) ? [] : bars, timesSec);
}

/** 没有外部数据时 compute() 的占位输出：与 K 线等长、全 null。 */
export function emptyCandles(length: number): CandleSeries {
  return new Array(length).fill(null);
}

export function isCandlePoint(v: unknown): v is CandlePoint {
  return typeof v === "object" && v !== null && "open" in v && "close" in v;
}
