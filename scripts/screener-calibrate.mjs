/**
 * 标定脚本：拉一批真实候选的序列，用**生产代码本身**测量两组常数是否还合适。
 *
 * 为什么需要它：CVD_SATURATION 和六场景的 cvdPct/oiPct 阈值都是从实测分布
 * 定出来的，而分布会随行情变。这些常数一旦漂了，症状是静默的——因子顶满
 * 变成常数、或者场景永远不触发——榜单上看不出来。dryrun 每轮打印分数分布
 * 是这件事的哨兵，这个脚本是哨兵报警之后用来重新量的尺子。
 *
 * 上一次标定（2026-08-19，14 币 × 336 根）发现的两件事，留作对照基线：
 *   1. CVD_SATURATION 原本是 0.15，来自一次 48 根 / 518 窗口的单日快照。
 *      在 7 天样本下有 16% 的窗口顶满 —— 样本太薄导致的低估，与数据源无关
 *      （Binance 单家与四家聚合的分布几乎重合：99% 分位 0.3067 vs 0.3018）。
 *   2. 六场景的判定要看端到端出现率，不能只看 |cvdPct| 的边际分布：
 *      单看边际，|cvdPct| >= 2% 覆盖了 78% 的摆动点对，像是形同虚设；
 *      但叠加 OI 与「价格创新极值」两个条件之后出现率完全不同。
 *
 * 用法（PowerShell）:
 *   $env:COINGLASS_API_KEY="..."; npx tsx scripts/screener-calibrate.mjs
 * 用法（bash）:
 *   COINGLASS_API_KEY=... npx tsx scripts/screener-calibrate.mjs
 *
 * 约 3 × SAMPLE_COINS 次上游调用，走的是和扫描同一个限流器。
 * 与 dryrun 一样，连续两次运行要隔一分钟以上。
 */
import { getFuturesTickers } from "../src/lib/bingx/market.ts";
import { getOpenInterestHistory } from "../src/lib/coinglass/open-interest.ts";
import { getPriceHistory } from "../src/lib/coinglass/price-history.ts";
import { getTakerVolumeHistory, CVD_EXCHANGES } from "../src/lib/coinglass/taker-volume.ts";
import { classifyScenario } from "../src/lib/screener/factors/scenario.ts";
import { cvdRawRatio, CVD_WINDOW_BARS, CVD_SATURATION } from "../src/lib/screener/factors/cvd.ts";
import { coinFromBingXSymbol, isSyntheticProduct, SERVER_GATE } from "../src/lib/screener/universe.ts";

const SAMPLE_COINS = 14;
/** 模拟扫描的推进步长，单位是 30m K 线根数（6 根 = 3 小时） */
const STEP = 6;
/** 少于这么多根就不判场景——摆动点要 PIVOT_N 前后各 5 根才确认 */
const MIN_BARS = 60;

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const tickers = await getFuturesTickers();
const pool = tickers
  .filter((t) => t.symbol.endsWith("-USDT") && !isSyntheticProduct(t.symbol))
  .map((t) => ({ coin: coinFromBingXSymbol(t.symbol), vol: parseFloat(t.quoteVolume) }))
  .filter((x) => Number.isFinite(x.vol) && x.vol >= SERVER_GATE.minBingxVolumeUsd)
  .sort((a, b) => b.vol - a.vol);

// 从成交额中段等距取样：头部是主流大币（被前 50 名门槛排除），
// 尾部是几乎不动的死币，两头都不代表真实候选。
const sample = [];
const start = Math.floor(pool.length * 0.1);
const span = Math.floor(pool.length * 0.55);
for (let i = 0; i < SAMPLE_COINS && start + i * Math.floor(span / SAMPLE_COINS) < pool.length; i++) {
  sample.push(pool[start + i * Math.floor(span / SAMPLE_COINS)].coin);
}
console.log(`样本 ${sample.length} 个币（CVD 源：${CVD_EXCHANGES.join("+")}）:`, sample.join(" "));

const data = [];
for (const coin of sample) {
  const [taker, price, oi] = await Promise.all([
    getTakerVolumeHistory(coin).catch(() => null),
    getPriceHistory("BingX", `${coin}-USDT`).catch(() => null),
    getOpenInterestHistory(coin).catch(() => null),
  ]);
  if (!taker?.length || !price?.length || !oi?.length) {
    console.log(`  ${coin}: 跳过（缺 ${[!taker && "taker", !price && "price", !oi && "oi"].filter(Boolean).join("/")}）`);
    continue;
  }
  data.push({ coin, taker, price, oi });
}
console.log(`可用 ${data.length} 个币\n`);

// ── 六场景出现率：滑动前缀模拟多轮扫描 ────────────────────────────
const counts = {};
const hitCvd = [];
const hitOi = [];
let rounds = 0;
for (const { taker, price, oi } of data) {
  const n = Math.min(taker.length, price.length, oi.length);
  for (let end = MIN_BARS; end <= n; end += STEP) {
    rounds++;
    const s = classifyScenario(price.slice(0, end), oi.slice(0, end), taker.slice(0, end));
    const key = s ? `${s.kind}${s.trap ? " ⚠" : ""}` : "(无场景)";
    counts[key] = (counts[key] ?? 0) + 1;
    if (s) {
      hitCvd.push(Math.abs(s.cvdPct));
      hitOi.push(Math.abs(s.oiPct));
    }
  }
}
console.log(`=== 六场景出现率（模拟 ${rounds} 轮扫描）===`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  ${((v / rounds) * 100).toFixed(1).padStart(5)}%`);
}
if (hitCvd.length) {
  console.log(`  命中时 |cvdPct| 中位 ${q(hitCvd, 0.5).toFixed(1)}% · 90% ${q(hitCvd, 0.9).toFixed(1)}%`);
  console.log(`  命中时 |oiPct|  中位 ${q(hitOi, 0.5).toFixed(1)}% · 90% ${q(hitOi, 0.9).toFixed(1)}%`);
}

// ── CVD 饱和点：量程有没有被用满或用爆 ──────────────────────────
// 测的是 cvdRawRatio（未除饱和点、未截断）。不能拿 cvdNorm 反推——
// 它的 99% 分位恒等于 1，乘回饱和点必然得到原值，见 cvdRawRatio 的注释。
const raws = [];
for (const { taker } of data) {
  for (let end = CVD_WINDOW_BARS; end <= taker.length; end++) {
    const v = cvdRawRatio(taker.slice(0, end), CVD_WINDOW_BARS);
    if (v !== null) raws.push(Math.abs(v));
  }
}
const pinned = (raws.filter((v) => v >= CVD_SATURATION).length / raws.length) * 100;
const implied = q(raws, 0.99);
console.log(`\n=== CVD 量程（CVD_SATURATION = ${CVD_SATURATION}，${raws.length} 个窗口）===`);
console.log(`  |原始比值| 中位 ${q(raws, 0.5).toFixed(3)} · 90% ${q(raws, 0.9).toFixed(3)} · 95% ${q(raws, 0.95).toFixed(3)} · 99% ${implied.toFixed(3)}`);
console.log(`  顶满（≥ 饱和点）比例 ${pinned.toFixed(2)}%  —— 饱和点取 99% 分位时这里应在 1% 上下`);
console.log(
  `  按本次样本反推，饱和点应为 ${implied.toFixed(3)}` +
    (Math.abs(implied - CVD_SATURATION) / CVD_SATURATION > 0.25
      ? "  ← 偏离超过 25%，该改了"
      : "  ← 仍然合适")
);
