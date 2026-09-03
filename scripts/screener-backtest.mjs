/**
 * 场景引擎的端到端回测。
 *
 * 存在的理由：这套系统到今天为止**没有任何一个场景跑过端到端度量**。八场景的
 * 门槛有的从旧引擎搬来（±7% OI、±10% CVD），有的是规格给了区间取下界
 * （1.5 倍斜率），没有一个是在新引擎上量出来的。而我们已经在这个没有度量的
 * 系统上连续调了六七个参数。
 *
 * 这个脚本回答一个问题：**判出某个场景之后，接下来 N 根 K 线里发生了什么，
 * 跟不判任何场景相比有没有区别。**
 *
 * ── 方法上的三条硬规矩，每一条都是踩过坑才立的 ──
 *
 * 1. **前瞻窗口不重叠。** 评估点的步长 ≥ 前瞻长度。重叠会把一次行情算成十几个
 *    观测，样本量看起来很大而其实只有一次，结论完全不可信——这个坑真的踩过，
 *    当时一个 pump 被算成约 24 个观测，得出「84% 的行情被漏掉」这种结论。
 *
 * 2. **按事件去重，不按观测计数。** 同一个场景在连续几个评估点上会重复判出，
 *    只算它第一次出现。
 *
 * 3. **抽样确定可复现。** 按币名字母序取，不按交易所返回的数组顺序——BingX
 *    ticker 的顺序会抖，按位置抽样每次跑出来的是不同的币，同一个指标能测出
 *    1.71x 和 0.72x 两个结果。
 *
 * ── 用法 ──
 *
 * 需要 CoinGlass 的 key（只读，脚本只发 GET）。**不要把 key 写进任何文件**，
 * 用环境变量传：
 *
 *   PowerShell:  $env:COINGLASS_API_KEY="..."; node scripts/screener-backtest.mjs
 *   bash:        COINGLASS_API_KEY=... node scripts/screener-backtest.mjs
 *
 * 可选参数（都有默认值）：
 *   --coins 40      抽多少个币
 *   --bars 1440     每个币拉多少根 30m K 线（1440 根 = 30 天；上游给多少算多少）
 *   --fwd 12        前瞻多少根（12 根 = 6 小时）
 *   --step 12       评估点步长（必须 ≥ fwd）
 *
 * 一轮大约要 (coins × 3) 次 CoinGlass 调用，客户端限流器会自己按 75 次/分钟
 * 排队，所以 40 个币约需 2 分钟。这不是 Vercel 函数，没有 60 秒上限。
 */
import { coinglassGet } from "../src/lib/coinglass/client.ts";
import { CVD_EXCHANGES } from "../src/lib/coinglass/taker-volume.ts";
import { classifyScenario } from "../src/lib/screener/factors/scenario.ts";
import { detectIgnition } from "../src/lib/screener/ignition.ts";
import { PRICE_EXCHANGE } from "../src/lib/screener/pipeline.ts";

// ── 参数
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const COINS = arg("coins", 40);
const BARS = arg("bars", 1440);
const FWD = arg("fwd", 12);
const STEP = Math.max(arg("step", 12), FWD); // 步长 < 前瞻 = 窗口重叠，直接夹住

if (!process.env.COINGLASS_API_KEY) {
  console.error(
    "缺 COINGLASS_API_KEY。脚本只发 GET，不写任何文件；用环境变量传，别写进代码里：\n" +
      '  PowerShell:  $env:COINGLASS_API_KEY="..."; node scripts/screener-backtest.mjs\n' +
      "  bash:        COINGLASS_API_KEY=... node scripts/screener-backtest.mjs"
  );
  process.exit(1);
}

// ── 币池：BingX 永续按成交额取前若干，再按币名字母序抽样（可复现）
const tickers = await (
  await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/ticker")
).json();
const pool = (tickers.data ?? [])
  .filter((t) => t.symbol.endsWith("-USDT") && !/^NC|\d+L-|\d+S-/.test(t.symbol))
  .map((t) => ({ symbol: t.symbol, vol: Number(t.quoteVolume) }))
  .filter((x) => Number.isFinite(x.vol))
  .sort((a, b) => b.vol - a.vol)
  .slice(0, 200)
  .sort((a, b) => a.symbol.localeCompare(b.symbol))
  .filter((_, i) => i % Math.max(1, Math.floor(200 / COINS)) === 0)
  .slice(0, COINS);

console.log(
  `样本 ${pool.length} 个币 · 每个 ${BARS} 根 30m · 前瞻 ${FWD} 根(${FWD / 2}h) · 步长 ${STEP} 根\n` +
    `预计 ${pool.length * 3} 次 CoinGlass 调用，限流 75/分钟，约 ${Math.ceil((pool.length * 3) / 75)} 分钟\n`
);

/** 三条序列按时间戳对齐到价格 K 线，长度不齐 classifyScenario 会直接判空。 */
function align(priceBars, oiBars, takerBars) {
  const oiByTime = new Map(oiBars.map((b) => [b.time, b]));
  const tkByTime = new Map(takerBars.map((b) => [b.time, b]));
  const keep = priceBars.filter((b) => oiByTime.has(b.time) && tkByTime.has(b.time));
  return [keep, keep.map((b) => oiByTime.get(b.time)), keep.map((b) => tkByTime.get(b.time))];
}

const pctl = (a, q) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * q)];
};

/** 从 t 往后 FWD 根，顺方向的最大有利/不利波动（%）。 */
function forward(bars, t, dir) {
  const entry = parseFloat(bars[t].close);
  let mfe = 0;
  let mae = 0;
  for (let k = t + 1; k <= t + FWD && k < bars.length; k++) {
    const h = parseFloat(bars[k].high);
    const l = parseFloat(bars[k].low);
    const fav = dir === "long" ? ((h - entry) / entry) * 100 : ((entry - l) / entry) * 100;
    const adv = dir === "long" ? ((entry - l) / entry) * 100 : ((h - entry) / entry) * 100;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
  }
  return { mfe, mae };
}

const events = []; // { kind, dir, mfe, mae }
const baseline = []; // 同样这些评估点、不看任何信号的基准
let usableCoins = 0;
let barsSeen = 0;

for (const { symbol } of pool) {
  const coin = symbol.replace(/-USDT$/, "").replace(/^1000+/, "");
  let price, oi, taker;
  try {
    [price, oi, taker] = await Promise.all([
      coinglassGet("/api/futures/price/history", {
        exchange: PRICE_EXCHANGE,
        symbol,
        interval: "30m",
        limit: BARS,
      }),
      coinglassGet("/api/futures/open-interest/aggregated-history", {
        symbol: coin,
        interval: "30m",
        limit: BARS,
      }),
      coinglassGet("/api/futures/aggregated-taker-buy-sell-volume/history", {
        symbol: coin,
        interval: "30m",
        limit: BARS,
        exchange_list: CVD_EXCHANGES.join(","),
      }),
    ]);
  } catch (err) {
    console.log(`  ${symbol.padEnd(14)} 跳过：${String(err).slice(0, 60)}`);
    continue;
  }

  const [P, O, T] = align(price ?? [], oi ?? [], taker ?? []);
  if (P.length < 120) {
    console.log(`  ${symbol.padEnd(14)} 跳过：对齐后只剩 ${P.length} 根`);
    continue;
  }
  if (usableCoins === 0) {
    // 第一个币就把实际拿到的根数报出来。上游给不给足 --bars 不由我们决定，
    // 跑完两分钟才发现只给了 336 根（7 天）是最没必要的浪费。
    console.log(
      `
  实际拿到：价格 ${price?.length ?? 0} 根 · OI ${oi?.length ?? 0} 根 · ` +
        `资金流 ${taker?.length ?? 0} 根 → 三条对齐后 ${P.length} 根（${(P.length / 48).toFixed(1)} 天）`
    );
    if (P.length < BARS * 0.5) {
      console.log(`  ⚠ 明显少于请求的 ${BARS} 根，样本期会比预期短——结论的置信度要相应打折。`);
    }
  }
  usableCoins++;
  barsSeen += P.length;

  // 同一个场景在连续评估点上会重复判出，只记第一次
  const seen = new Set();

  for (let t = 60; t < P.length - FWD; t += STEP) {
    const p = P.slice(0, t + 1);
    const o = O.slice(0, t + 1);
    const k = T.slice(0, t + 1);

    // 基准：不看任何信号，在这个时点上多头方向能拿到什么
    baseline.push(forward(P, t, "long"));

    const sc = classifyScenario(p, o, k);
    if (sc) {
      const key = `${sc.kind}|${sc.triggeredAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        const dir = sc.direction === "manage" ? "long" : sc.direction;
        events.push({ kind: sc.kind, dir, ...forward(P, t, dir) });
      }
    }

    const ig = detectIgnition(p, o);
    if (ig) {
      const key = `ignition|${ig.ignitedAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        const dir = ig.direction === "up" ? "long" : "short";
        events.push({ kind: `ignition_${ig.direction}`, dir, ...forward(P, t, dir) });
      }
    }
  }
  process.stdout.write(".");
}

console.log(`\n\n可用 ${usableCoins} 个币 · 共 ${barsSeen} 根 · 事件 ${events.length} 个\n`);

function row(name, group) {
  if (group.length === 0) return `${name.padEnd(24)} ${"0".padStart(5)}`;
  const mfe = pctl(group.map((e) => e.mfe), 0.5);
  const mae = pctl(group.map((e) => e.mae), 0.5);
  const win = (group.filter((e) => e.mfe > e.mae).length / group.length) * 100;
  const big = (group.filter((e) => e.mfe >= 2).length / group.length) * 100;
  return (
    name.padEnd(24) +
    String(group.length).padStart(5) +
    (mfe.toFixed(2) + "%").padStart(10) +
    (mae.toFixed(2) + "%").padStart(10) +
    (win.toFixed(0) + "%").padStart(8) +
    (big.toFixed(0) + "%").padStart(9)
  );
}

console.log("场景".padEnd(24) + "样本".padStart(5) + "MFE中位".padStart(10) + "MAE中位".padStart(10) + "胜率".padStart(8) + "≥2%".padStart(9));
console.log("─".repeat(66));
console.log(row("【基准】不看信号", baseline.map((b) => ({ ...b }))));
console.log("─".repeat(66));

const kinds = [...new Set(events.map((e) => e.kind))].sort();
for (const k of kinds) console.log(row(k, events.filter((e) => e.kind === k)));

console.log("─".repeat(66));
console.log(row("全部场景合计", events.filter((e) => !e.kind.startsWith("ignition"))));
console.log(row("全部点火合计", events.filter((e) => e.kind.startsWith("ignition"))));

console.log(
  "\n怎么读：**跟【基准】那一行比**。绝对数字没有意义——一个 6 小时窗口里\n" +
    "任何币都会波动 1% 上下，MFE 1.4% 看着像回事，但基准也是 1.4% 的话，\n" +
    "这个场景就等于没有信息。要看的是胜率和 ≥2% 占比有没有拉开差距。\n" +
    "样本 < 30 的行不要当真，那个量级的差异基本都是噪音。"
);
