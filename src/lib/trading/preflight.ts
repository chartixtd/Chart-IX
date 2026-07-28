import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSymbolSpec } from "./spec";
import { quoteToBase, validateOrderSize, formatQty, requiredMargin } from "./sizing";
import { mergeLimits, checkLimits } from "./limits";
import { countOrdersToday } from "./persist";
import { getSpotTicker, getFuturesTicker } from "@/lib/bingx/market";
import type { TradingLimits, PreflightInput, PreflightResult, TradingMarket } from "@/types/trading";

interface LimitsRow {
  max_notional_per_order: number | null;
  max_orders_per_day: number | null;
  max_leverage: number | null;
  allowed_symbols: string[] | null;
}

const UNLIMITED: TradingLimits = {
  maxNotionalPerOrder: null,
  maxOrdersPerDay: null,
  maxLeverage: null,
  allowedSymbols: null,
};

// userId 会被拼进 PostgREST 的 `.or()` 过滤字符串里（Supabase JS 对 .or() 不做参数化）。
// 调用方目前都是从 supabase.auth.getUser() 拿到的 JWT sub（UUID），但这个函数是可被
// 直接调用的库函数，不应假设调用方一定校验过输入。非 UUID 一律当成查不到配置处理，
// 既堵住了逗号/括号注入 .or() 表达式的路径，也避免了一次无意义的数据库往返。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToLimits(row: LimitsRow | undefined): TradingLimits | null {
  if (!row) return null;
  return {
    maxNotionalPerOrder: row.max_notional_per_order,
    maxOrdersPerDay: row.max_orders_per_day,
    maxLeverage: row.max_leverage,
    allowedSymbols: row.allowed_symbols,
  };
}

/** 取全局默认 + 该用户的覆盖配置并合并 */
export async function loadLimitsFor(
  supabase: SupabaseClient,
  userId: string
): Promise<TradingLimits> {
  if (!UUID_RE.test(userId)) {
    Sentry.captureMessage("loadLimitsFor: non-UUID userId", {
      tags: { scope: "loadLimitsFor" },
      level: "warning",
    });
    return { ...UNLIMITED };
  }

  const { data, error } = await supabase
    .from("trading_limits")
    .select("user_id, max_notional_per_order, max_orders_per_day, max_leverage, allowed_symbols")
    .or(`user_id.is.null,user_id.eq.${userId}`);

  if (error) {
    // 读不到限额配置时按「不限制」放行：限额是管理员设的可选护栏，
    // 不该因为一次读表失败就让所有人无法下单。异常上报 Sentry 便于发现。
    Sentry.captureException(error, { tags: { scope: "loadLimitsFor" } });
    return { ...UNLIMITED };
  }

  const rows = (data ?? []) as Array<LimitsRow & { user_id: string | null }>;
  const global = rowToLimits(rows.find((r) => r.user_id === null));
  const user = rowToLimits(rows.find((r) => r.user_id === userId));
  return mergeLimits(global, user);
}

// 新鲜度窗口：实测（2026-07-29，直连 live 接口）现货 `/ticker/24hr` 与合约
// `/quote/ticker` 的 `closeTime` 相对当时墙钟时间都在 1 秒以内——`closeTime`
// 是这份 24 小时统计的快照时间，每次请求都会重新计算，与该交易对是否冷门、
// 是否有人在交易无关，所以理论上任何交易对每次请求都应该拿到"刚刚"的时间戳。
// 30 秒的窗口在此基础上留出充足的网络往返/CDN 余量，同时仍然远小于"响应被
// 缓存/失败后返回陈旧数据"这类真实故障的量级（通常是分钟级）。
const PRICE_FRESHNESS_WINDOW_MS = 30_000;
// 时钟偏差容忍：服务器时钟略快于 BingX 时钟是正常的，但 closeTime 大幅领先
// 本地时间说明时间戳本身不可信，同样应当拒绝而不是采信一个"来自未来"的价格。
const PRICE_CLOCK_SKEW_MS = 5_000;

/**
 * 获取服务端市价。
 *
 * 风控估值绝不能用客户端提交的价格：调用方只要谎称 BTC 值 1 美元，
 * 就能让「100 USDT」的订单换算出 100 BTC，而风控看到的名义额仍是 100 USDT
 * （因为 qty × 客户端价格 恒等于 notionalUsdt）。价格必须由服务端自己取。
 *
 * 用的是公开行情接口，无需签名。
 *
 * 新鲜度校验：`BingXTicker.closeTime`（现货、合约均返回，见 `src/types/bingx.ts`
 * 的实测记录）是行情快照时间，ms epoch。这里要求它落在
 * `[now - PRICE_FRESHNESS_WINDOW_MS, now + PRICE_CLOCK_SKEW_MS]` 区间内，
 * 缺失、非法或超出该区间一律当作取不到市价处理，绝不采信一个陈旧或时间戳
 * 不可信的价格用于风控估值。
 *
 * `lastPrice` 类型在现货（number）与合约（string）两个接口之间不一致，
 * 统一走 `Number()` 解析，不做任何字符串操作。
 */
async function fetchMarketPrice(symbol: string, market: TradingMarket): Promise<number> {
  const ticker = market === "spot"
    ? await getSpotTicker(symbol)
    : await getFuturesTicker(symbol);
  if (!ticker) return 0;

  const price = Number(ticker.lastPrice);
  if (!(Number.isFinite(price) && price > 0)) return 0;

  const closeTime = Number(ticker.closeTime);
  if (!Number.isFinite(closeTime)) return 0;
  const age = Date.now() - closeTime;
  if (age > PRICE_FRESHNESS_WINDOW_MS || age < -PRICE_CLOCK_SKEW_MS) return 0;

  return price;
}

/**
 * 下单前置检查：规格 → 市价 → 换算 → 尺寸校验 → 风控限额。
 * 返回 ok:true 时，qty 已经对齐精度、可直接发给 BingX。
 */
export async function preflightOrder(
  supabase: SupabaseClient,
  input: PreflightInput
): Promise<PreflightResult> {
  const spec = await getSymbolSpec(input.symbol, input.market, input.direction);
  if (!spec) return { ok: false, code: "UNKNOWN_SYMBOL" };

  const marketPrice = await fetchMarketPrice(input.symbol, input.market);
  if (!(marketPrice > 0)) return { ok: false, code: "NO_MARKET_PRICE" };

  // 换算基准：市价单一律用服务端市价；限价单用用户的限价（那是用户的真实意图）
  const sizingPrice = input.isLimitOrder ? input.referencePrice : marketPrice;
  const sizing = quoteToBase(input.notionalUsdt, sizingPrice, spec);
  const sizeCheck = validateOrderSize(sizing, spec);
  if (!sizeCheck.ok) return { ok: false, code: sizeCheck.reason, limit: sizeCheck.limit };

  // 真实敞口按服务端市价计算，而不是 sizing.notional——后者对市价单恒等于
  // 用户提交的 notionalUsdt，对限价单则随用户的限价任意缩放，两者都不能用于风控
  const riskNotionalUsdt = sizing.qty * marketPrice;

  // 交易所杠杆上限不在公开规格里（BingX 的公开合约接口不返回 maxLongLeverage /
  // maxShortLeverage，2026-07-29 实测 0/944），因此 spec.maxLeverage 实践中恒为
  // undefined，这里只能强制管理员配置的上限。超出交易所上限的请求由交易所拒绝，
  // 错误经 errors.ts 映射。若 BingX 日后恢复公开返回，下面这行会自动收紧为两者更严者。
  const limits = await loadLimitsFor(supabase, input.userId);
  const effectiveMaxLeverage =
    spec.maxLeverage === undefined
      ? limits.maxLeverage
      : limits.maxLeverage === null
        ? spec.maxLeverage
        : Math.min(limits.maxLeverage, spec.maxLeverage);

  const ordersToday = await countOrdersToday(supabase, input.userId);
  const limitCheck = checkLimits(
    {
      symbol: input.symbol,
      notional: riskNotionalUsdt,
      leverage: input.leverage,
      ordersToday,
    },
    { ...limits, maxLeverage: effectiveMaxLeverage }
  );
  if (!limitCheck.ok) return { ok: false, code: limitCheck.reason, limit: limitCheck.limit };

  return {
    ok: true,
    spec,
    qty: formatQty(sizing.qty, spec),
    sizing,
    requiredMarginUsdt: requiredMargin(sizing.notional, input.leverage),
    marketPrice,
    riskNotionalUsdt,
  };
}
