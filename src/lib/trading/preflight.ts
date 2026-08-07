import { getSymbolSpec } from "./spec";
import { quoteToBase, validateOrderSize, formatQty, requiredMargin } from "./sizing";
import { getSpotTicker, getFuturesTicker } from "@/lib/bingx/market";
import type { PreflightInput, PreflightResult, TradingMarket } from "@/types/trading";

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
 * 下单前置检查：规格 → 市价 → 换算 → 尺寸校验。
 * 返回 ok:true 时，qty 已经对齐精度、可直接发给 BingX。
 *
 * 不再做任何管理员配置的限额校验（名义额/每日笔数/杠杆/交易对白名单）——
 * 那套机制连同 trading_limits 表已整体移除。谁能下真实单由权限层决定
 * （见 src/lib/access.ts：仅 Pro 用户可下实盘，免费用户只能用模拟账户），
 * 剩下的护栏是交易所自身的规格与保证金规则。
 */
export async function preflightOrder(input: PreflightInput): Promise<PreflightResult> {
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
  // 用户提交的 notionalUsdt，对限价单则随用户的限价任意缩放。这个值是「服务端
  // 没有采信客户端报价」的可观测证据，preflight.test.ts 就断言在它上面。
  const riskNotionalUsdt = sizing.qty * marketPrice;

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
