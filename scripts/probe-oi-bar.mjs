/**
 * 探针：CoinGlass 的 OI 历史接口，**最后一根是收盘值还是当前周期的实时快照**？
 *
 * 判据很干脆：同一个时间戳的那一根，隔一分钟再拉一次，值变没变。
 *   · 值不变 → 收盘值（这根已经定死，新数据会开一根新的）
 *   · 值在变 → 实时快照（这根还在走，它的「close」其实是「此刻」）
 *
 * ── 为什么要问这个 ──
 *
 * 场景判定里几乎每一处 OI 读数都落在**最后一根**上：
 *   · factors/scenario.ts 的 leg(ctx, from, ctx.last) —— A1/A2/A3/A4 全都用它
 *     算 oiPct 与 oiState，而 oiState 直接决定卡片的措辞和强度档
 *   · ignition.ts 的 oiChangeAt(oiBars, origin) —— 点火那根就是最后一根时
 *     （barsAgo = 0，也就是刚点火那一刻），这道门读的是同一个值
 *
 * 如果它是实时快照，那么同一根 K 线走完之前，OI 读数会一直漂：一次扫描判
 * oiState="flat"、下一次变 "up"，卡片的名字、操作文案、强度徽章跟着变，
 * 而 K 线其实还是同一根。这类抖动看起来就像「系统在乱跳」，而且很难查——
 * 所以先把事实钉死，再决定要不要在判定里排除未走完的那一根。
 *
 * ── 用法 ──
 *
 * key 走环境变量，脚本只发 GET、不写任何文件、不把 key 落进输出：
 *
 *   PowerShell:  $env:COINGLASS_API_KEY="..."; npx tsx scripts/probe-oi-bar.mjs
 *   bash:        COINGLASS_API_KEY=... npx tsx scripts/probe-oi-bar.mjs
 *
 * 可选：--coin BTC --interval 30m --gap 60（两次拉取间隔秒数）
 */
import { coinglassGet } from "../src/lib/coinglass/client.ts";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const COIN = arg("coin", "BTC");
const INTERVAL = arg("interval", "30m");
const GAP = Number(arg("gap", 60));

if (!process.env.COINGLASS_API_KEY) {
  console.error(
    "缺 COINGLASS_API_KEY。脚本只发 GET，不写文件；用环境变量传：\n" +
      '  PowerShell:  $env:COINGLASS_API_KEY="..."; npx tsx scripts/probe-oi-bar.mjs\n' +
      "  bash:        COINGLASS_API_KEY=... npx tsx scripts/probe-oi-bar.mjs"
  );
  process.exit(1);
}

const num = (v) => (typeof v === "number" ? v : parseFloat(v));

async function pull() {
  const bars = await coinglassGet("/api/futures/open-interest/aggregated-history", {
    symbol: COIN,
    interval: INTERVAL,
    limit: 3,
  });
  return bars.map((b) => ({ time: b.time, close: num(b.close), high: num(b.high), low: num(b.low) }));
}

const t0 = new Date();
const a = await pull();
console.log(`${COIN} · ${INTERVAL} · 第一次拉取 ${t0.toISOString().slice(11, 19)}`);
for (const b of a) {
  console.log(`  ${new Date(b.time).toISOString().slice(11, 16)}  close=${b.close}  high=${b.high}  low=${b.low}`);
}

console.log(`\n等 ${GAP} 秒…`);
await new Promise((r) => setTimeout(r, GAP * 1000));

const b = await pull();
const t1 = new Date();
console.log(`第二次拉取 ${t1.toISOString().slice(11, 19)}`);
for (const x of b) {
  console.log(`  ${new Date(x.time).toISOString().slice(11, 16)}  close=${x.close}  high=${x.high}  low=${x.low}`);
}

// ── 结论
const lastA = a[a.length - 1];
const sameBar = b.find((x) => x.time === lastA.time);

console.log("\n────────── 结论 ──────────");
if (!sameBar) {
  console.log(
    `两次拉取之间已经翻到了新的一根（${new Date(lastA.time).toISOString().slice(11, 16)} → ` +
      `${new Date(b[b.length - 1].time).toISOString().slice(11, 16)}）。\n` +
      `这一次判不出来，把 --gap 调小（比如 30）或换个刚开盘不久的时刻再跑一次。`
  );
} else if (sameBar.close === lastA.close) {
  console.log(
    `同一根（${new Date(lastA.time).toISOString().slice(11, 16)}）的 close 没变：${lastA.close}\n` +
      `→ 倾向于**收盘值**。但只测了一次 ${GAP} 秒的间隔，OI 恰好一分钟没动也是可能的，\n` +
      `  拿个活跃的币多跑两次（--coin SOL --gap 90）再下结论。`
  );
} else {
  const drift = ((sameBar.close - lastA.close) / lastA.close) * 100;
  console.log(
    `同一根（${new Date(lastA.time).toISOString().slice(11, 16)}）的 close 变了：\n` +
      `  ${lastA.close} → ${sameBar.close}   （${drift >= 0 ? "+" : ""}${drift.toFixed(4)}%）\n` +
      `→ **实时快照**。最后一根还没走完，它的 close 就是「此刻」。\n\n` +
      `影响：场景判定里 leg(ctx, from, ctx.last) 和点火的 OI 门读的都是这一根，\n` +
      `所以同一根 K 线走完之前，oiState 可能在 flat/up/down 之间来回跳，\n` +
      `卡片的名字、操作文案、强度徽章会跟着变——而 K 线其实还是同一根。`
  );
}
