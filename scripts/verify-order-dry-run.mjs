#!/usr/bin/env node
/**
 * 用 BingX 官方 dry-run 端点验证全部合约订单类型的参数正确性。
 * 不会真正成交。
 *
 * 用法：
 *   BINGX_API_KEY=xxx BINGX_SECRET=yyy node scripts/verify-order-dry-run.mjs
 *
 * 注意：只读环境变量里的密钥，绝不触碰数据库中用户的加密密钥。
 */
import { createHmac } from "node:crypto";

const API_KEY = process.env.BINGX_API_KEY;
const SECRET = process.env.BINGX_SECRET;
const SYMBOL = process.env.SYMBOL || "BTC-USDT";

if (!API_KEY || !SECRET) {
  console.error("Set BINGX_API_KEY and BINGX_SECRET in the environment.");
  process.exit(1);
}

const BASE = "https://open-api.bingx.com";

async function signedPost(path, params) {
  const all = { ...params, timestamp: Date.now() };
  const qs = Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join("&");
  const sig = createHmac("sha256", SECRET).update(qs).digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "X-BX-APIKEY": API_KEY,
      "X-SOURCE-KEY": "BX-AI-SKILL",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `${qs}&signature=${sig}`,
    signal: AbortSignal.timeout(10000),
  });
  return JSON.parse(await res.text());
}

async function getJson(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: { "X-SOURCE-KEY": "BX-AI-SKILL" } });
  return res.json();
}

const contracts = await getJson("/openApi/swap/v2/quote/contracts");
const contract = (contracts.data || []).find((c) => c.symbol === SYMBOL);
if (!contract) {
  console.error(`Contract not found: ${SYMBOL}`);
  process.exit(1);
}

const ticker = await getJson("/openApi/swap/v2/quote/ticker", { symbol: SYMBOL });
const price = parseFloat(ticker.data?.lastPrice ?? ticker.data?.[0]?.lastPrice ?? "0");
if (!(price > 0)) {
  console.error("Could not read a reference price");
  process.exit(1);
}

// 用最小名义额的两倍换算数量，向下取整到合约精度
const notional = Math.max(contract.tradeMinUSDT * 2, 10);
const p = contract.quantityPrecision;
const qty = (Math.floor((notional / price) * 10 ** p) / 10 ** p).toFixed(p);

console.log(`Symbol ${SYMBOL} · price ${price} · qty ${qty} (notional ≈ ${notional} USDT)`);
console.log(`quantityPrecision=${p} tradeMinUSDT=${contract.tradeMinUSDT} maxLongLeverage=${contract.maxLongLeverage}\n`);

const dual = await (async () => {
  const all = { timestamp: Date.now() };
  const qs = `timestamp=${all.timestamp}`;
  const sig = createHmac("sha256", SECRET).update(qs).digest("hex");
  const res = await fetch(`${BASE}/openApi/swap/v1/positionSide/dual?${qs}&signature=${sig}`, {
    headers: { "X-BX-APIKEY": API_KEY, "X-SOURCE-KEY": "BX-AI-SKILL" },
  });
  const j = await res.json();
  // BingX 文档说这里是 bool，但同一接口的 POST 收字符串 "true"/"false"，
  // signedRequest 式的响应又不做运行时校验——app 里 account-mode.ts 已经
  // 踩过这个坑（2026-07-29 修复），这里独立实现同一份判断，同样要兼容两种形状。
  const raw = j.data?.dualSidePosition;
  return raw === true || raw === "true";
})();

const positionSide = dual ? "LONG" : "BOTH";
console.log(`Account position mode: ${dual ? "hedge (LONG/SHORT)" : "one-way (BOTH)"} → positionSide=${positionSide}\n`);

const base = { symbol: SYMBOL, side: "BUY", positionSide, quantity: qty };
const cases = [
  ["MARKET", { ...base, type: "MARKET" }],
  ["LIMIT", { ...base, type: "LIMIT", price: (price * 0.9).toFixed(contract.pricePrecision), timeInForce: "GTC" }],
  ["STOP_MARKET", { ...base, type: "STOP_MARKET", stopPrice: (price * 0.9).toFixed(contract.pricePrecision) }],
  ["STOP", { ...base, type: "STOP", stopPrice: (price * 0.9).toFixed(contract.pricePrecision), price: (price * 0.89).toFixed(contract.pricePrecision) }],
  ["TAKE_PROFIT_MARKET", { ...base, type: "TAKE_PROFIT_MARKET", stopPrice: (price * 1.1).toFixed(contract.pricePrecision) }],
  ["TAKE_PROFIT", { ...base, type: "TAKE_PROFIT", stopPrice: (price * 1.1).toFixed(contract.pricePrecision), price: (price * 1.11).toFixed(contract.pricePrecision) }],
  // priceRate 是小数：0.01 = 1%。这里正是修复前会误发 1（=100%）的地方
  ["TRAILING_STOP_MARKET", { ...base, type: "TRAILING_STOP_MARKET", priceRate: 0.01 }],
  ["TRAILING_TP_SL", { ...base, type: "TRAILING_TP_SL", priceRate: 0.01 }],
  ["MARKET + attached TP/SL", {
    ...base, type: "MARKET",
    stopLoss: JSON.stringify({ type: "STOP_MARKET", stopPrice: Number((price * 0.9).toFixed(contract.pricePrecision)), workingType: "MARK_PRICE" }),
    takeProfit: JSON.stringify({ type: "TAKE_PROFIT_MARKET", stopPrice: Number((price * 1.1).toFixed(contract.pricePrecision)), workingType: "MARK_PRICE" }),
  }],
];

let failed = 0;
for (const [name, params] of cases) {
  const r = await signedPost("/openApi/swap/v2/trade/order/test", params);
  const ok = r.code === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → ${r.code}: ${r.msg}`}`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed > 0 ? 1 : 0);
