/**
 * 手动跑一轮真实上游、打印完整榜单与四因子明细。
 *
 * 这是这套流水线唯一的端到端验证手段 —— pipeline.ts 全是网络编排，
 * 给它写单元测试只能测到 mock 的行为，而真正会出问题的是
 * 「CoinGlass 某个字段换了名字」「某个币在 Binance 没有合约」这类事，
 * mock 永远发现不了。上线前和每次调参后都跑一次。
 *
 * 用法（PowerShell）:
 *   $env:COINGLASS_API_KEY="..."; npx tsx scripts/screener-dryrun.mjs
 * 用法（bash）:
 *   COINGLASS_API_KEY=... npx tsx scripts/screener-dryrun.mjs
 */
import { runScan } from "../src/lib/screener/pipeline.ts";
import { ALERT_TRIGGER_SCORE, FACTOR_MAX } from "../src/lib/screener/types.ts";

const started = Date.now();
const payload = await runScan();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n候选池 ${payload.rows.length} 个 · 耗时 ${elapsed}s\n`);
console.log("SYMBOL".padEnd(14), "DIR  ", "TOT", `  OI/${FACTOR_MAX.oi} CVD/${FACTOR_MAX.cvd}`, "  VOL(M)", " AMP%", "  CAP(M)", " SRC");

for (const r of payload.rows.slice(0, 40)) {
  const f = r.factors;
  console.log(
    r.coin.padEnd(14),
    r.direction.toUpperCase().padEnd(6),
    String(r.total).padStart(3),
    String(f.oi).padStart(5),
    String(f.cvd).padStart(6),
    (r.volumeUsd / 1e6).toFixed(1).padStart(8),
    r.amplitude.toFixed(1).padStart(6),
    (r.marketCap / 1e6).toFixed(0).padStart(8),
    r.sourceExchange
  );
}

const qualified = payload.rows.filter((r) => r.total >= ALERT_TRIGGER_SCORE);
console.log(`\n≥${ALERT_TRIGGER_SCORE} 分（会触发警报）：${qualified.length} 个 —— ${qualified.map((r) => r.coin).join(", ") || "无"}`);

// 分布是判断打分曲线松紧的唯一依据。全挤在 40–60 说明曲线太保守，
// 一大半 ≥80 说明门槛形同虚设。
const buckets = [0, 20, 40, 60, 80, 100];
for (let i = 0; i < buckets.length - 1; i++) {
  const n = payload.rows.filter((r) => r.total >= buckets[i] && r.total < buckets[i + 1]).length;
  console.log(`${buckets[i]}–${buckets[i + 1]}: ${"█".repeat(n)} ${n}`);
}
