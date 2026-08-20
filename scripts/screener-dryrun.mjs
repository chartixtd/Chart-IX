/**
 * 手动跑一轮真实上游、打印完整榜单、两因子明细与六场景判定。
 *
 * 这是这套流水线唯一的端到端验证手段 —— pipeline.ts 全是网络编排，
 * 给它写单元测试只能测到 mock 的行为，而真正会出问题的是
 * 「CoinGlass 某个字段换了名字」「某个币在 Binance 没有合约」这类事，
 * mock 永远发现不了。上线前和每次调参后都跑一次。
 *
 * 注意：连续两次运行要间隔一分钟以上——客户端限流器是进程内状态，
 * 新进程不知道上一分钟已经用掉多少配额，连跑会撞服务端 429，
 * 输出一堆假的中性分。
 *
 * 用法（PowerShell）:
 *   $env:COINGLASS_API_KEY="..."; npx tsx scripts/screener-dryrun.mjs
 * 用法（bash）:
 *   COINGLASS_API_KEY=... npx tsx scripts/screener-dryrun.mjs
 */
import { runScan } from "../src/lib/screener/pipeline.ts";
import { FACTOR_MAX, AMPLITUDE_RANK_TAKE } from "../src/lib/screener/types.ts";
import { readVolumeCache } from "../src/lib/screener/volume-cache.ts";

// 成交量缓存是选币的前置条件：缓存空 = 没有任何币能证明成交量达标 = 空榜。
// 先把它的状态打出来，否则一份空榜单看不出是「上游挂了」还是「缓存还没暖」。
const vc = await readVolumeCache();
const ages = [...vc.values()].map((v) => (Date.now() - v.updatedAt) / 60000).sort((a, b) => a - b);
console.log(
  `成交量缓存：${vc.size} 个币` +
    (ages.length ? ` · 最新 ${ages[0].toFixed(0)} 分钟前 · 最旧 ${ages[ages.length - 1].toFixed(0)} 分钟前` : "")
);
if (vc.size === 0) {
  console.log(
    "⚠ 缓存是空的。要么 migration 050 还没跑，要么 cron 的空转 tick 还没刷过一轮。\n" +
      "  这种情况下榜单必然是空的——这是刻意的：宁可空榜，也不要一份绕过流动性门槛的榜单。"
  );
}

const started = Date.now();
const payload = await runScan();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const scen = (r) =>
  r.scenario
    ? `${r.scenario.kind}${r.scenario.trap ? " ⚠陷阱" : ""} (${r.scenario.direction}, CVD${r.scenario.cvdPct >= 0 ? "+" : ""}${r.scenario.cvdPct.toFixed(1)}% OI${r.scenario.oiPct >= 0 ? "+" : ""}${r.scenario.oiPct.toFixed(1)}%)`
    : "—";

console.log(`\n候选池 ${payload.rows.length} 个 · 耗时 ${elapsed}s\n`);
console.log(
  "SYMBOL".padEnd(12),
  "DIR    ",
  "TOT",
  ` OI/${FACTOR_MAX.oi} CVD/${FACTOR_MAX.cvd}`,
  " VOL(M)",
  " AMP%",
  " CAP(M)",
  "场景"
);

for (const r of payload.rows.slice(0, 40)) {
  const f = r.factors;
  console.log(
    r.coin.padEnd(12),
    r.direction.toUpperCase().padEnd(7),
    (r.dataGaps.length ? "—" : String(r.total)).padStart(3),
    String(f.oi).padStart(5),
    String(f.cvd).padStart(6),
    (r.volumeUsd / 1e6).toFixed(1).padStart(7),
    r.amplitude.toFixed(1).padStart(5),
    (r.marketCap / 1e6).toFixed(0).padStart(7),
    scen(r)
  );
}

// 警报由场景驱动，不再看分数线
const qualified = payload.rows.filter((r) => r.scenario !== null);
console.log(
  `\n检测到场景（会触发警报）：${qualified.length} 个 —— ${qualified.map((r) => `${r.coin}(${r.scenario.kind})`).join(", ") || "无"}`
);

// 分数分布仍然打印——分数管排序，场景管警报，两者独立观察。
// 全挤在同一个桶说明打分曲线出了问题（历史上发生过一次，是 429 导致
// 全部退化成中性分——所以这个分布同时也是「这轮有没有撞限流」的哨兵）。
const buckets = [0, 20, 40, 60, 80, 100];
for (let i = 0; i < buckets.length - 1; i++) {
  const n = payload.rows.filter((r) => r.total >= buckets[i] && r.total < buckets[i + 1]).length;
  console.log(`${buckets[i]}–${buckets[i + 1]}: ${"█".repeat(n)} ${n}`);
}
