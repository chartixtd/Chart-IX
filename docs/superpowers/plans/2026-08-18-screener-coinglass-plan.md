# CoinGlass 四因子扫描器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 screener 的数据源换成 CoinGlass v4，打分模型换成 Zone/Sweep/OI/CVD 四因子（30/20/30/20 = 100 分），扫描周期缩到 15 分钟，并新增警报持久化与 Telegram 推送。

**Architecture:** 三段式服务端流水线（批量层 → 行情层 → 明细层）由 pg_cron/GitHub Actions 每 5 分钟 tick、服务端按 15 分钟门控。四个因子实现为不碰网络、不碰 DB 的纯函数，每个币对 long/short 各算一遍，方向 = 高分那边。结果整池（约 150 行）写入 `screener_cache`，前端滑块纯客户端过滤。

**Tech Stack:** Next.js 15 App Router · TypeScript · vitest（node 环境）· Supabase（service role + pg_cron）· TanStack Query · Tailwind（现有 token）· next-intl（zh-CN / en-US / ms-MY）

## Global Constraints

- 分支：`feat/screener-coinglass`。不要合并到 main。
- 包管理：npm。测试命令 `npm test`（vitest run）。vitest 只收集 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts` —— 测试文件必须放在 `src/lib/` 下，放别处不会被执行。
- CoinGlass base URL：`https://open-api-v4.coinglass.com`，鉴权头 `CG-API-KEY`。
- 环境变量 `COINGLASS_API_KEY`，**绝不写进仓库**（不进 `.env.example` 之外的任何文件，不进代码常量，不进测试）。
- CoinGlass Startup 套餐限制（实测，不要试图绕过）：K 线最小粒度 `30m`；`coins-markets`、`rsi/list`、爆仓热力图返回 401 `Upgrade plan`。
- ~~上游并发上限 120（实测 120 并发 2.48 秒全部 200）。~~ **Task 19 更新：这条结论被证伪。**
  真实约束是响应头 `API-KEY-MAX-LIMIT: 80`——**每分钟 80 次请求**，不是并发数。
  那次压测只打了一轮 120 个请求，单次爆发没触发速率限制，流水线一轮真正要打几百次时
  必然撞穿这条线。并发上限改为 12，见 Task 19 附记与当前 `src/lib/coinglass/client.ts`。
- Vercel Hobby 函数 `maxDuration` 上限 60 秒 —— 扫描路由必须显式 `export const maxDuration = 60`。
- 四因子满分：Zone 30、Sweep 20、OI 30、CVD 20，总分恒在 `[0, 100]`。
- 警报触发线 80、关闭线 75、迟滞 3 次连续低于关闭线。
- ~~服务端候选池门槛：BingX 永续 `-USDT` 可交易 ∩ 非合成品 ∩ CoinGecko 排名 > 50 ∩ 市值 20M–800M ∩ BingX 24h 振幅 ≥ 0.5% ∩ CoinGlass `volume_usd` ≥ 5M。~~
  **Task 19 更新**：`CoinGlass volume_usd ≥ 5M` 门槛已删除，换成 `BingX quoteVolume ≥ 2M`
  （只挡真正没有成交的假带，不当真流动性判断）；新增预排序从粗筛池子里选出
  `DEEP_SCAN_LIMIT` 个才进明细层——这个数**不是写死的**，从限流器的
  `RATE_LIMIT_PER_MIN`（75）推导，目前为 14（`2 + 14 × 5 = 72 ≤ 75`）。详见 Task 19 附记
  （附记里还记录了第一版写死 15 导致撞穿限流窗口、跑到 60.7 秒的返工）。
- 客户端滑块范围：成交量 5–25M（默认 15M）、振幅 1–5%（默认 3%）、市值下限 30–500M（默认 30M，上限固定 500M）。
- i18n 三个 locale 都要补：`src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`。漏掉 ms-MY 会让马来语页面缺键。
- 注释用中文，与现有代码风格一致：解释**为什么**这么写、以及**不能改成什么**，不要复述代码在做什么。
- 每个任务结束都提交，commit message 用中文正文 + 结尾 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/lib/coinglass/client.ts` | `CG-API-KEY` 注入、`code !== "0"` 归一成异常、超时、并发池 |
| `src/lib/coinglass/types.ts` | 各端点响应的 TS 类型 |
| `src/lib/coinglass/market.ts` | `pairs-markets`、`funding-rate/exchange-list` |
| `src/lib/coinglass/open-interest.ts` | `open-interest/exchange-list` |
| `src/lib/coinglass/liquidation.ts` | `liquidation/coin-list`、`liquidation/history` |
| `src/lib/coinglass/price-history.ts` | `price/history` |
| `src/lib/coinglass/taker-volume.ts` | `taker-buy-sell-volume/history` |
| `src/lib/screener/types.ts` | `ScannerRow`、`FactorBreakdown`、`ScannerPayload`、常量 |
| `src/lib/screener/universe.ts` | 候选池门槛与构建 |
| `src/lib/screener/factors/zone.ts` | Volume Profile → 0–30 |
| `src/lib/screener/factors/sweep.ts` | 爆仓峰值 + 收回 → 0–20 |
| `src/lib/screener/factors/oi.ts` | OI × 价格四象限 → 0–30 |
| `src/lib/screener/factors/cvd.ts` | CVD 斜率 + 背离 → 0–20 |
| `src/lib/screener/score.ts` | 四因子组装、定方向、总分 |
| `src/lib/screener/pipeline.ts` | 三段式编排 |
| `src/lib/screener/cache.ts` | TTL + Supabase 双层缓存 |
| `src/lib/screener/alerts.ts` | 警报状态机 |
| `src/app/api/cron/screener-scan/route.ts` | 扫描入口 |
| `src/components/screener/ScreenerFilters.tsx` | 三滑块 + 方向切换 + 候选数 |
| `src/components/screener/FactorStack.tsx` | 四因子堆叠柱 |
| `src/components/screener/ScannerTable.tsx` | 主扫描表 |
| `src/components/screener/AlertRail.tsx` | 警报栏容器 |
| `src/components/screener/AlertCard.tsx` | 单条警报卡 |
| `supabase/migrations/048_screener_alerts.sql` | `screener_alerts` 表 + pg_cron tick |
| `scripts/screener-dryrun.mjs` | 手动跑一轮真实 API |

**修改**

| 文件 | 改动 |
|---|---|
| `src/app/api/screener/route.ts` | 改读新 cache |
| `src/hooks/useScreenerData.ts` | 改成新 payload 形状 |
| `src/app/[locale]/(app)/screener/page.tsx` | 按 demo 重做布局 |
| `src/lib/telegram-push.ts` | 行格式从 `ScreenerResult` 双榜迁到 `ScannerRow` 单表 |
| `src/app/api/cron/telegram-push/route.ts` | 换 import |
| `src/hooks/useMarketCap.ts` / `useMarketData.ts` | 改用 `MARKET_CAP_REFRESH_MS` |
| `src/lib/market-cap.ts` | 新增 `MARKET_CAP_REFRESH_MS` |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 新增/替换 `screener` 文案 |
| `.env.example` | 新增 `COINGLASS_API_KEY` |
| `.github/workflows/cron-tick.yml` | `*/10` → `*/5`，新增 screener-scan 一步 |

**删除**

`src/lib/screener-scoring.ts`、`src/lib/screener-scoring.test.ts`、`src/lib/screener-server.ts`、`src/components/screener/ScreenerTable.tsx`

---

### Task 1: CoinGlass HTTP 客户端

**Files:**
- Create: `src/lib/coinglass/client.ts`
- Create: `src/lib/coinglass/types.ts`
- Test: `src/lib/coinglass/client.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: 无
- Produces:
  - `coinglassGet<T>(path: string, params?: Record<string, string | number>): Promise<T>` —— 返回已剥掉外层信封的 `data`
  - `runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit?: number): Promise<Array<T | null>>` —— 单个任务抛错时该位置为 `null`，整体不 reject
  - `CoinGlassError extends Error`，带 `code: string` 与 `status: number`
  - `COINGLASS_CONCURRENCY = 120`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/coinglass/client.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coinglassGet, runWithConcurrency, CoinGlassError } from "./client";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.COINGLASS_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("coinglassGet", () => {
  it("剥掉信封只返回 data", async () => {
    mockFetchOnce({ code: "0", data: [{ a: 1 }] });
    await expect(coinglassGet("/api/futures/supported-coins")).resolves.toEqual([{ a: 1 }]);
  });

  it("把 code!==0 归一成 CoinGlassError 而不是当成正常返回", async () => {
    mockFetchOnce({ code: "401", msg: "Upgrade plan" });
    await expect(coinglassGet("/api/futures/coins-markets")).rejects.toBeInstanceOf(CoinGlassError);
  });

  it("缺少 API key 时立刻抛错，而不是让上游返回一个含义不明的 401", async () => {
    delete process.env.COINGLASS_API_KEY;
    mockFetchOnce({ code: "0", data: [] });
    await expect(coinglassGet("/api/futures/supported-coins")).rejects.toThrow(/COINGLASS_API_KEY/);
  });

  it("把 key 放进 CG-API-KEY 头，而不是查询串", async () => {
    mockFetchOnce({ code: "0", data: [] });
    await coinglassGet("/api/futures/supported-coins");
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["CG-API-KEY"]).toBe("test-key");
  });

  it("把数字参数序列化进查询串", async () => {
    mockFetchOnce({ code: "0", data: [] });
    await coinglassGet("/api/futures/price/history", { symbol: "BTCUSDT", limit: 336 });
    const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("symbol=BTCUSDT");
    expect(String(url)).toContain("limit=336");
  });
});

describe("runWithConcurrency", () => {
  it("单个任务失败只让该位置变 null，不带倒整批", async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error("boom");
      },
      async () => 3,
    ];
    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual([1, null, 3]);
  });

  it("同时在飞的任务数不超过 limit", async () => {
    let inflight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return 1;
    });
    await runWithConcurrency(tasks, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("保持结果顺序与任务顺序一致", async () => {
    const tasks = [
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
      async () => "fast",
    ];
    await expect(runWithConcurrency(tasks, 2)).resolves.toEqual(["slow", "fast"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/coinglass/client.test.ts`
Expected: FAIL，`Failed to resolve import "./client"`

- [ ] **Step 3: 写实现**

创建 `src/lib/coinglass/types.ts`：

```ts
/** CoinGlass v4 的统一信封。code 是字符串 "0" 表示成功，不是数字。 */
export interface CoinGlassEnvelope<T> {
  code: string;
  msg?: string;
  data?: T;
}

/** /api/futures/pairs-markets 的一行（一个交易所的一个合约） */
export interface CoinGlassPairMarket {
  instrument_id: string;
  exchange_name: string;
  symbol: string;
  current_price: number;
  price_change_percent_24h: number;
  volume_usd: number;
  open_interest_usd: number;
  open_interest_change_percent_24h: number;
  funding_rate: number;
  open_interest_volume_radio: number;
}

/** /api/futures/open-interest/exchange-list 的一行；exchange === "All" 是聚合行 */
export interface CoinGlassOpenInterestRow {
  exchange: string;
  symbol: string;
  open_interest_usd: number;
  open_interest_change_percent_5m: number;
  open_interest_change_percent_15m: number;
  open_interest_change_percent_30m: number;
  open_interest_change_percent_1h: number;
  open_interest_change_percent_4h: number;
  open_interest_change_percent_24h: number;
}

/** /api/futures/liquidation/coin-list 的一行（全交易所聚合） */
export interface CoinGlassLiquidationCoin {
  symbol: string;
  liquidation_usd_1h: number;
  long_liquidation_usd_1h: number;
  short_liquidation_usd_1h: number;
  liquidation_usd_24h: number;
  long_liquidation_usd_24h: number;
  short_liquidation_usd_24h: number;
}

/** /api/futures/liquidation/history 的一根。金额是字符串，调用方负责 parseFloat。 */
export interface CoinGlassLiquidationBar {
  time: number;
  long_liquidation_usd: string;
  short_liquidation_usd: string;
}

/** /api/futures/price/history 的一根。OHLCV 全是字符串。 */
export interface CoinGlassPriceBar {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_usd: string;
}

/** /api/futures/taker-buy-sell-volume/history 的一根 */
export interface CoinGlassTakerBar {
  time: number;
  taker_buy_volume_usd: string;
  taker_sell_volume_usd: string;
}

/** /api/futures/funding-rate/exchange-list 的一行 */
export interface CoinGlassFundingRow {
  symbol: string;
  stablecoin_margin_list?: Array<{ exchange: string; funding_rate: number }>;
}
```

创建 `src/lib/coinglass/client.ts`：

```ts
import type { CoinGlassEnvelope } from "./types";

const BASE_URL = "https://open-api-v4.coinglass.com";
const TIMEOUT_MS = 20_000;

/**
 * 实测（2026-08-18）：120 个并发 pairs-markets 请求全部 200，总耗时 2.48 秒。
 * 上游不是瓶颈，Vercel Hobby 的 60 秒函数上限才是——所以这个数是按
 * 「明细层 600 次调用要在 13 秒内跑完」倒推的，不是照 CoinGlass 文档抄的。
 * 往下调会让明细层线性变慢并逼近 60 秒上限，往上调收益已经很小。
 */
export const COINGLASS_CONCURRENCY = 120;

export class CoinGlassError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CoinGlassError";
  }
}

/**
 * CoinGlass 用 HTTP 200 + 信封里的 code 表达业务失败（套餐不够是 "401"、
 * 缺参数是 "400"），所以只看 res.ok 会把「Upgrade plan」当成一次成功的空响应
 * 一路带进打分逻辑。这里统一归一成异常，让调用方的降级分支真的能触发。
 */
export async function coinglassGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) throw new Error("COINGLASS_API_KEY is not configured");

  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      // key 只走请求头。放查询串会被 Vercel 的访问日志与任何中间代理原样记下来。
      headers: { "CG-API-KEY": key, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new CoinGlassError(`CoinGlass ${path} HTTP ${res.status}`, String(res.status), res.status);
    }
    const json = (await res.json()) as CoinGlassEnvelope<T>;
    if (json.code !== "0") {
      throw new CoinGlassError(
        `CoinGlass ${path} returned code ${json.code}: ${json.msg ?? "unknown"}`,
        json.code,
        res.status
      );
    }
    if (json.data === undefined) {
      throw new CoinGlassError(`CoinGlass ${path} returned no data`, "empty", res.status);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 固定 limit 个 worker 轮流从队列取活，而不是「切成 limit 大小的批、批间等齐」。
 * 分批会被批内最慢的那个请求拖住整批；worker 池里谁先空出来谁接下一个。
 *
 * 单个任务失败写成 null 而不是 reject 整体：一个币的一个端点挂掉不该让
 * 另外 149 个币的数据全部作废——调用方按 null 走各自因子的缺失分支。
 * 返回顺序与入参顺序一致，调用方可以按下标对回 symbol。
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number = COINGLASS_CONCURRENCY
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(tasks.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = await tasks[index]();
      } catch {
        results[index] = null;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
```

在 `.env.example` 末尾追加：

```
# CoinGlass v4 API key（Startup 套餐）。screener 扫描流水线用。
COINGLASS_API_KEY=
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/coinglass/client.test.ts`
Expected: PASS，8 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/coinglass/client.ts src/lib/coinglass/types.ts src/lib/coinglass/client.test.ts .env.example
git commit -m "feat(coinglass): HTTP 客户端与并发池

CoinGlass 用 HTTP 200 + 信封里的 code 表达业务失败（套餐不够是 "401"），
只看 res.ok 会把「Upgrade plan」当成一次成功的空响应带进打分逻辑，
所以统一归一成 CoinGlassError。key 只走请求头不进查询串。

并发池 120 是按「明细层 600 次调用要在 13 秒内跑完、总时长不撞
Vercel Hobby 的 60 秒上限」倒推的，不是照文档抄的。单任务失败写成
null 而不是 reject 整体——一个币的一个端点挂掉不该作废另外 149 个。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: CoinGlass 端点封装

**Files:**
- Create: `src/lib/coinglass/market.ts`
- Create: `src/lib/coinglass/open-interest.ts`
- Create: `src/lib/coinglass/liquidation.ts`
- Create: `src/lib/coinglass/price-history.ts`
- Create: `src/lib/coinglass/taker-volume.ts`
- Test: `src/lib/coinglass/market.test.ts`

**Interfaces:**
- Consumes: `coinglassGet` (Task 1)
- Produces:
  - `getPairsMarkets(coin: string): Promise<CoinGlassPairMarket[]>`
  - `getFundingRateList(): Promise<CoinGlassFundingRow[]>`
  - `pickExchangeRow<T extends { exchange_name: string; volume_usd: number }>(rows: T[], preferred: string): T | undefined`
  - `getOpenInterestExchangeList(coin: string): Promise<CoinGlassOpenInterestRow[]>`
  - `pickAggregatedOi(rows: CoinGlassOpenInterestRow[]): CoinGlassOpenInterestRow | undefined`
  - `getLiquidationCoinList(): Promise<CoinGlassLiquidationCoin[]>`
  - `getLiquidationHistory(exchange: string, instrumentId: string): Promise<CoinGlassLiquidationBar[]>`
  - `getPriceHistory(exchange: string, instrumentId: string): Promise<CoinGlassPriceBar[]>`
  - `getTakerVolumeHistory(exchange: string, instrumentId: string): Promise<CoinGlassTakerBar[]>`
  - `PRICE_HISTORY_LIMIT = 336`、`SERIES_LIMIT = 48`、`SERIES_INTERVAL = "30m"`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/coinglass/market.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { pickExchangeRow } from "./market";
import { pickAggregatedOi } from "./open-interest";
import type { CoinGlassOpenInterestRow } from "./types";

const rows = [
  { exchange_name: "Binance", volume_usd: 900, current_price: 1 },
  { exchange_name: "BingX", volume_usd: 100, current_price: 1.01 },
  { exchange_name: "Bybit", volume_usd: 500, current_price: 0.99 },
];

describe("pickExchangeRow", () => {
  it("优先返回指定交易所", () => {
    expect(pickExchangeRow(rows, "BingX")?.exchange_name).toBe("BingX");
  });

  it("指定交易所不存在时回落到成交额最大的一家", () => {
    expect(pickExchangeRow(rows, "Kraken")?.exchange_name).toBe("Binance");
  });

  it("空数组返回 undefined 而不是抛错", () => {
    expect(pickExchangeRow([], "Binance")).toBeUndefined();
  });
});

describe("pickAggregatedOi", () => {
  const oiRows = [
    { exchange: "Binance", open_interest_usd: 10 },
    { exchange: "All", open_interest_usd: 30 },
  ] as CoinGlassOpenInterestRow[];

  it("只认 All 这一行——单交易所 OI 噪音大，聚合才是真实杠杆水位", () => {
    expect(pickAggregatedOi(oiRows)?.open_interest_usd).toBe(30);
  });

  it("没有 All 行时返回 undefined，绝不退而求其次拿单交易所顶替", () => {
    expect(pickAggregatedOi([oiRows[0]])).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/coinglass/market.test.ts`
Expected: FAIL，`Failed to resolve import "./market"`

- [ ] **Step 3: 写实现**

创建 `src/lib/coinglass/market.ts`：

```ts
import { coinglassGet } from "./client";
import type { CoinGlassPairMarket, CoinGlassFundingRow } from "./types";

/** 一个币在所有交易所的合约行情。Startup 套餐没有全币批量端点，只能逐币调。 */
export function getPairsMarkets(coin: string): Promise<CoinGlassPairMarket[]> {
  return coinglassGet<CoinGlassPairMarket[]>("/api/futures/pairs-markets", { symbol: coin });
}

/** 全币资金费率，一次调用拿全（约 2MB）。 */
export function getFundingRateList(): Promise<CoinGlassFundingRow[]> {
  return coinglassGet<CoinGlassFundingRow[]>("/api/futures/funding-rate/exchange-list");
}

/**
 * 按交易所挑一行，挑不到就回落到成交额最大的那家。
 *
 * 回落而不是返回 undefined 是刻意的：BingX 上有一批币在 Binance 没有合约，
 * 如果没有回落，这些币的 K 线/CVD 会整块缺失、四因子里三个走缺失分支，
 * 等于把「Binance 没上市」误读成「这个币没有信号」。
 */
export function pickExchangeRow<T extends { exchange_name: string; volume_usd: number }>(
  rows: T[],
  preferred: string
): T | undefined {
  const exact = rows.find((r) => r.exchange_name === preferred);
  if (exact) return exact;
  return rows.reduce<T | undefined>(
    (best, r) => (best === undefined || r.volume_usd > best.volume_usd ? r : best),
    undefined
  );
}
```

创建 `src/lib/coinglass/open-interest.ts`：

```ts
import { coinglassGet } from "./client";
import type { CoinGlassOpenInterestRow } from "./types";

/**
 * 持仓量快照。这个端点不受 Startup 套餐的 30 分钟 K 线粒度限制，
 * 直接给 5m/15m/30m/1h/4h/24h 六个窗口的变化率——OI 因子要的新鲜度
 * 全靠它，不要改成去拉 open-interest/history 序列。
 */
export function getOpenInterestExchangeList(coin: string): Promise<CoinGlassOpenInterestRow[]> {
  return coinglassGet<CoinGlassOpenInterestRow[]>("/api/futures/open-interest/exchange-list", {
    symbol: coin,
  });
}

/**
 * 只认 exchange === "All" 这一行。小市值币在单个交易所的持仓量噪音极大，
 * 聚合才是真实杠杆水位。拿不到 All 就返回 undefined 让 OI 因子走中性分，
 * 绝不退而求其次拿某一家顶替——那会让不同币的 OI 分在描述不同的市场。
 */
export function pickAggregatedOi(
  rows: CoinGlassOpenInterestRow[]
): CoinGlassOpenInterestRow | undefined {
  return rows.find((r) => r.exchange === "All");
}
```

创建 `src/lib/coinglass/liquidation.ts`：

```ts
import { coinglassGet } from "./client";
import type { CoinGlassLiquidationCoin, CoinGlassLiquidationBar } from "./types";
import { SERIES_INTERVAL, SERIES_LIMIT } from "./price-history";

/** 全币爆仓（1h/4h/12h/24h，全交易所聚合），一次调用拿全。 */
export function getLiquidationCoinList(): Promise<CoinGlassLiquidationCoin[]> {
  return coinglassGet<CoinGlassLiquidationCoin[]>("/api/futures/liquidation/coin-list");
}

/** 近 24 小时的 30 分钟爆仓序列。Startup 套餐拿不到比 30m 更细的粒度。 */
export function getLiquidationHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassLiquidationBar[]> {
  return coinglassGet<CoinGlassLiquidationBar[]>("/api/futures/liquidation/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: SERIES_LIMIT,
  });
}
```

创建 `src/lib/coinglass/price-history.ts`：

```ts
import { coinglassGet } from "./client";
import type { CoinGlassPriceBar } from "./types";

/**
 * Startup 套餐支持的最细粒度。服务端在 403 里直接返回了白名单：
 * ["30m","1h","2h","4h","6h","8h","12h","1d","1w"]，15m 及以下一律拒绝。
 * 不要改成 "15m"——那会让明细层每个币都 403，四因子里三个整块失效。
 */
export const SERIES_INTERVAL = "30m";

/** 近 24 小时 = 48 根 30 分钟。CVD 与 Sweep 共用这个长度。 */
export const SERIES_LIMIT = 48;

/** 7 天 = 336 根 30 分钟。Zone 的成交量分布要这么长才有意义。 */
export const PRICE_HISTORY_LIMIT = 336;

/**
 * 一根 7 天 30m 的 K 线同时喂四处：Zone 的成交量分布、Sweep 的收回确认、
 * OI 的同窗口价格变化、以及展示用的真 24h 振幅。不要为了其中某一个
 * 再拉第二次——那是每轮多 150 次上游调用。
 */
export function getPriceHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassPriceBar[]> {
  return coinglassGet<CoinGlassPriceBar[]>("/api/futures/price/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: PRICE_HISTORY_LIMIT,
  });
}
```

创建 `src/lib/coinglass/taker-volume.ts`：

```ts
import { coinglassGet } from "./client";
import type { CoinGlassTakerBar } from "./types";
import { SERIES_INTERVAL, SERIES_LIMIT } from "./price-history";

/** 近 24 小时的主动买/卖成交额，CVD 的唯一数据源。 */
export function getTakerVolumeHistory(
  exchange: string,
  instrumentId: string
): Promise<CoinGlassTakerBar[]> {
  return coinglassGet<CoinGlassTakerBar[]>("/api/futures/taker-buy-sell-volume/history", {
    exchange,
    symbol: instrumentId,
    interval: SERIES_INTERVAL,
    limit: SERIES_LIMIT,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/coinglass/market.test.ts`
Expected: PASS，5 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/coinglass/
git commit -m "feat(coinglass): 五个端点封装

粒度常量集中在 price-history.ts：30m 是 Startup 套餐支持的最细粒度
（服务端 403 里直接返回了白名单），改成 15m 会让明细层每个币都 403。

pickExchangeRow 挑不到指定交易所时回落到成交额最大的一家，而不是
返回 undefined：BingX 上有一批币在 Binance 没有合约，不回落等于把
「Binance 没上市」误读成「这个币没有信号」。

pickAggregatedOi 相反，只认 All 行、拿不到就 undefined——小市值币
单交易所的持仓量噪音极大，拿某一家顶替会让不同币的 OI 分
在描述不同的市场。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 类型、常量与候选池门槛

**Files:**
- Create: `src/lib/screener/types.ts`
- Create: `src/lib/screener/universe.ts`
- Test: `src/lib/screener/universe.test.ts`
- Modify: `src/lib/market-cap.ts`（新增 `MARKET_CAP_REFRESH_MS`）
- Modify: `src/hooks/useMarketCap.ts`、`src/hooks/useMarketData.ts`（改用新常量）

**Interfaces:**
- Consumes: `MarketCapMap`、`stripContractMultiplier`、`TOP_MARKET_CAP_EXCLUDED`（`@/lib/market-cap`）；`BingXTicker`（`@/types/bingx`）
- Produces:
  - `SCAN_INTERVAL_MS = 900_000`、`ALERT_TRIGGER_SCORE = 80`、`ALERT_CLOSE_SCORE = 75`、`ALERT_CLOSE_STREAK = 3`、`FACTOR_MAX`
  - `FactorBreakdown`、`ScannerRow`、`ScannerPayload`、`Direction` 类型
  - `SERVER_GATE`、`CLIENT_SLIDER` 常量对象
  - `isSyntheticProduct(symbol: string): boolean`
  - `coinFromBingXSymbol(symbol: string): string`
  - `preselect(tickers: BingXTicker[], marketCapMap: MarketCapMap): PreselectCandidate[]`
  - `PreselectCandidate = { bingxSymbol: string; coin: string; marketCap: number; marketCapRank: number }`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/universe.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { preselect, isSyntheticProduct, coinFromBingXSymbol, SERVER_GATE, CLIENT_SLIDER } from "./universe";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

function ticker(symbol: string, high: number, low: number): BingXTicker {
  return {
    symbol,
    openPrice: String(low),
    highPrice: String(high),
    lowPrice: String(low),
    lastPrice: high,
    volume: "1000",
    quoteVolume: "10000000",
    priceChange: "0",
    priceChangePercent: "0",
    closeTime: 0,
  };
}

const caps: MarketCapMap = {
  "TIA-USDT": { marketCap: 300_000_000, rank: 120 },
  "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
  "HUGE-USDT": { marketCap: 900_000_000, rank: 60 },
  "TINY-USDT": { marketCap: 10_000_000, rank: 800 },
  "FLAT-USDT": { marketCap: 200_000_000, rank: 150 },
};

describe("门槛包含关系", () => {
  it("服务端门槛必须比滑块能拉到的最紧值更宽，否则滑块会滑进空池子", () => {
    expect(SERVER_GATE.minVolumeUsd).toBeLessThanOrEqual(CLIENT_SLIDER.volume.min * 1_000_000);
    expect(SERVER_GATE.minMarketCap).toBeLessThan(CLIENT_SLIDER.marketCapFloor.min * 1_000_000);
    expect(SERVER_GATE.maxMarketCap).toBeGreaterThan(CLIENT_SLIDER.marketCapCeiling * 1_000_000);
  });

  it("振幅两边不同源，服务端必须留余量而不是取等值", () => {
    expect(SERVER_GATE.minAmplitude).toBeLessThan(CLIENT_SLIDER.amplitude.min);
  });
});

describe("isSyntheticProduct", () => {
  it("拦住代币化的股票/商品/指数/外汇", () => {
    expect(isSyntheticProduct("NCSK-USDT")).toBe(true);
    expect(isSyntheticProduct("NCCO-USDT")).toBe(true);
    expect(isSyntheticProduct("NCSI-USDT")).toBe(true);
    expect(isSyntheticProduct("NCFX-USDT")).toBe(true);
  });

  it("不误伤 NCASH 这类真实币种", () => {
    expect(isSyntheticProduct("NCASH-USDT")).toBe(false);
  });
});

describe("coinFromBingXSymbol", () => {
  it("剥掉 -USDT 后缀", () => {
    expect(coinFromBingXSymbol("TIA-USDT")).toBe("TIA");
  });

  it("剥掉合约乘数前缀，让它能对上 CoinGlass 的币种名", () => {
    expect(coinFromBingXSymbol("1000PEPE-USDT")).toBe("PEPE");
  });
});

describe("preselect", () => {
  it("放行市值与振幅都达标的币", () => {
    expect(preselect([ticker("TIA-USDT", 1.02, 1)], caps).map((c) => c.coin)).toEqual(["TIA"]);
  });

  it("排除排名前 50 的主流大币", () => {
    expect(preselect([ticker("BTC-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除市值超过上限的大盘币", () => {
    expect(preselect([ticker("HUGE-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除市值低于下限的微型盘", () => {
    expect(preselect([ticker("TINY-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("查不到市值一律排除——下限是必须证明达标的条件", () => {
    expect(preselect([ticker("UNKNOWN-USDT", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除振幅不足的币", () => {
    expect(preselect([ticker("FLAT-USDT", 1.001, 1)], caps)).toHaveLength(0);
  });

  it("排除非 -USDT 交易对", () => {
    expect(preselect([ticker("TIA-USDC", 1.02, 1)], caps)).toHaveLength(0);
  });

  it("排除合成品", () => {
    expect(preselect([ticker("NCSK-USDT", 1.5, 1)], caps)).toHaveLength(0);
  });

  it("同一个币只出现一次", () => {
    expect(preselect([ticker("TIA-USDT", 1.02, 1), ticker("TIA-USDT", 1.03, 1)], caps)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/universe.test.ts`
Expected: FAIL，`Failed to resolve import "./universe"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/types.ts`：

```ts
export type Direction = "long" | "short";

/**
 * 扫描间隔 15 分钟。触发器（pg_cron / GitHub Actions）打得比这更密，
 * 由服务端按这个数门控——「漏掉的一轮由下一轮补上」，
 * 与早报和榜单推送是同一条原则。
 */
export const SCAN_INTERVAL_MS = 900_000;

/** 总分达到这个数触发警报 */
export const ALERT_TRIGGER_SCORE = 80;

/**
 * 警报关闭线。刻意低于触发线：80 分线上的抖动会让一个币在几十分钟内
 * 反复开关警报、反复推送。这段迟滞区间是必需的，不是可选优化。
 */
export const ALERT_CLOSE_SCORE = 75;

/** 连续多少次扫描低于关闭线才真的关闭警报（约 45 分钟） */
export const ALERT_CLOSE_STREAK = 3;

export const FACTOR_MAX = {
  zone: 30,
  sweep: 20,
  oi: 30,
  cvd: 20,
} as const;

export interface FactorBreakdown {
  zone: number;
  sweep: number;
  oi: number;
  cvd: number;
}

export interface ScannerRow {
  /** BingX 永续 symbol，如 "TIA-USDT"。下单链接与警报表都用它当主键。 */
  symbol: string;
  /** CoinGlass 币种名，如 "TIA"。剥掉了 -USDT 与合约乘数前缀。 */
  coin: string;
  direction: Direction;
  /** 0–100，等于 factors 四项之和（已取整） */
  total: number;
  factors: FactorBreakdown;
  /** BingX 的成交价——用户在哪儿下单就显示哪儿的价 */
  price: number;
  /** CoinGlass 全交易所 24h 涨跌 % */
  change24h: number | null;
  /** 30m K 线算的真 24h 振幅 % */
  amplitude: number;
  /** CoinGlass volume_usd（真实值，不是 BingX 被拍平的 quoteVolume） */
  volumeUsd: number;
  marketCap: number;
  marketCapRank: number;
  /** BingX 那一行的资金费率；缺失时是全交易所中位数；都拿不到为 null */
  fundingRate: number | null;
  /** K 线/CVD 实际取自哪个交易所，供前端标注数据来源 */
  sourceExchange: string;
}

export interface ScannerPayload {
  rows: ScannerRow[];
  /** 这份结果的计算时间，ms epoch —— 前端用它算倒计时 */
  computedAt: number;
}
```

创建 `src/lib/screener/universe.ts`：

```ts
import { stripContractMultiplier, TOP_MARKET_CAP_EXCLUDED } from "@/lib/market-cap";
import type { MarketCapMap } from "@/lib/market-cap";
import type { BingXTicker } from "@/types/bingx";

/**
 * 服务端门槛：只负责把池子收到约 150 行，不负责表达用户口味。
 * 真正的筛选在客户端滑块上——服务端对整个池子算一次分，滑块只决定哪些行显示，
 * 所以拉动滑块不会改变任何币的分数，也不会改变警报触发。
 */
export const SERVER_GATE = {
  /** CoinGlass volume_usd 下限。与滑块最小值取等值即可——两边同源，能精确对齐。 */
  minVolumeUsd: 5_000_000,
  minMarketCap: 20_000_000,
  maxMarketCap: 800_000_000,
  /**
   * BingX ticker 的 24h 高低算出的振幅下限，单位 %。
   *
   * 必须严格小于滑块最小值（1%）：粗筛发生在拉 K 线之前，只能用 BingX 的高低，
   * 而客户端滑块用的是 30m K 线算的真振幅。两边不同源却取等值，会误杀一个
   * 真振幅 1.2%、BingX 高低算出 0.95% 的币——而且这种误杀在榜单上完全看不出来。
   */
  minAmplitude: 0.5,
} as const;

/** 客户端滑块的取值域。单位：成交量与市值是百万美元，振幅是 %。 */
export const CLIENT_SLIDER = {
  volume: { min: 5, max: 25, default: 15 },
  amplitude: { min: 1, max: 5, default: 3 },
  marketCapFloor: { min: 30, max: 500, default: 30 },
  /** 市值上限固定，不做成滑块（demo 的读数就是 "30M – 500M"） */
  marketCapCeiling: 500,
} as const;

/**
 * BingX 在永续里混了一批代币化的股票/商品/指数/外汇（NCSK=股票、NCCO=商品、
 * NCSI=指数、NCFX=外汇），它们不是加密货币，不该出现在小市值币筛选器里。
 * 用四个明确前缀而不是裸 "NC"，避免误伤 NCASH 这类真实币种。
 */
export function isSyntheticProduct(symbol: string): boolean {
  return /^NC(SK|CO|SI|FX)/.test(symbol);
}

/**
 * BingX 永续 symbol → CoinGlass 币种名。
 * 两处差异都要抹平：-USDT 后缀，以及 1000PEPE 这种合约乘数前缀
 * （CoinGlass 那边叫 PEPE，对不上就整个币拿不到任何明细数据）。
 */
export function coinFromBingXSymbol(symbol: string): string {
  return stripContractMultiplier(symbol).replace(/-USDT$/, "");
}

export interface PreselectCandidate {
  bingxSymbol: string;
  coin: string;
  marketCap: number;
  marketCapRank: number;
}

/**
 * 批量层的粗筛：只用 BingX ticker + CoinGecko 市值，一次额外的上游调用都不花。
 *
 * 成交额**不在这里筛** —— BingX 长尾的 quoteVolume 是被拍平的假数据
 * （516 个永续里有 144 个全挤在 619–691 万这个 0.73M 宽的带里），
 * 拿它筛成交额等于用假数据决定谁进池子。成交额筛选放到行情层，
 * 用 CoinGlass 的 volume_usd 做，这正是明细层要拆成两段的原因。
 *
 * 查不到市值一律排除：下限是一个「必须证明达标」的条件，
 * 在 CoinGecko 前 1000 名里查不到就无法证明市值 ≥ 2000万，只能当不达标处理。
 */
export function preselect(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap
): PreselectCandidate[] {
  const seen = new Set<string>();
  const out: PreselectCandidate[] = [];

  for (const t of tickers) {
    if (!t.symbol.endsWith("-USDT")) continue;
    if (isSyntheticProduct(t.symbol)) continue;
    if (seen.has(t.symbol)) continue;

    const entry = marketCapMap[stripContractMultiplier(t.symbol)];
    if (entry === undefined) continue;
    if (entry.rank <= TOP_MARKET_CAP_EXCLUDED) continue;
    if (entry.marketCap < SERVER_GATE.minMarketCap) continue;
    if (entry.marketCap > SERVER_GATE.maxMarketCap) continue;

    const high = parseFloat(t.highPrice);
    const low = parseFloat(t.lowPrice);
    if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) continue;
    if (((high - low) / low) * 100 < SERVER_GATE.minAmplitude) continue;

    seen.add(t.symbol);
    out.push({
      bingxSymbol: t.symbol,
      coin: coinFromBingXSymbol(t.symbol),
      marketCap: entry.marketCap,
      marketCapRank: entry.rank,
    });
  }

  // 排序只是为了让候选池顺序稳定（BingX 返回数组的顺序会抖动），便于比对与排查
  return out.sort((a, b) => a.bingxSymbol.localeCompare(b.bingxSymbol));
}
```

在 `src/lib/market-cap.ts` 里 `TOP_MARKET_CAP_EXCLUDED` 声明之后追加：

```ts
/**
 * 市值与全量行情的客户端刷新节奏，1 小时。
 *
 * 原先这两处借用 screener 的刷新间隔，但 screener 已改成 15 分钟一扫，
 * 继续共用会让市值和全量 ticker 也变成 15 分钟一拉——市值一小时才变一次，
 * 那是纯粹多打 3 倍的 CoinGecko 请求（免密钥档限流很凶）。
 */
export const MARKET_CAP_REFRESH_MS = 3_600_000;
```

改 `src/hooks/useMarketCap.ts`：删掉第 6 行 `import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";`，把第 4 行改成 `import { buildMarketCapMap, MARKET_CAP_REFRESH_MS } from "@/lib/market-cap";`，并把第 19、20 行的 `SCREENER_REFRESH_MS` 替换为 `MARKET_CAP_REFRESH_MS`。

改 `src/hooks/useMarketData.ts`：把第 8 行换成 `import { MARKET_CAP_REFRESH_MS } from "@/lib/market-cap";`，第 84 行改为 `refetchInterval: MARKET_CAP_REFRESH_MS,`，第 85 行改为 `staleTime: MARKET_CAP_REFRESH_MS / 2,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/universe.test.ts`
Expected: PASS，13 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/ src/lib/market-cap.ts src/hooks/useMarketCap.ts src/hooks/useMarketData.ts
git commit -m "feat(screener): 类型、常量与候选池粗筛

粗筛刻意不筛成交额：BingX 长尾的 quoteVolume 是被拍平的假数据，
拿它决定谁进池子等于用假数据筛选。成交额挪到行情层用 CoinGlass 的
volume_usd 做——这正是明细层要拆成两段的原因。

振幅门槛 0.5% 严格小于滑块最小值 1%，因为两边不同源：粗筛发生在
拉 K 线之前只能用 BingX 高低，客户端用 30m K 线算真振幅。取等值
会误杀真振幅 1.2%、BingX 算出 0.95% 的币，而且在榜单上完全看不出来。
这个包含关系由测试钉死。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Zone 因子（成交量分布价值区）

**Files:**
- Create: `src/lib/screener/factors/zone.ts`
- Test: `src/lib/screener/factors/zone.test.ts`

**Interfaces:**
- Consumes: `CoinGlassPriceBar`（`@/lib/coinglass/types`）、`Direction`、`FACTOR_MAX`（`@/lib/screener/types`）
- Produces:
  - `buildVolumeProfile(bars: CoinGlassPriceBar[]): VolumeProfile | null`
  - `VolumeProfile = { poc: number; val: number; vah: number }`
  - `zonePosition(price: number, profile: VolumeProfile): number`
  - `zoneScore(price: number, bars: CoinGlassPriceBar[], direction: Direction): number` —— 0–30，数据不足返回中性 15
  - `ZONE_BUCKETS = 50`、`VALUE_AREA_RATIO = 0.7`、`ZONE_BREAKDOWN_ZERO_AT = -0.5`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/factors/zone.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildVolumeProfile, zonePosition, zoneScore, ZONE_BREAKDOWN_ZERO_AT } from "./zone";
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";

/** 造一根 K 线：整根都落在 [low, high]，成交额 volume。 */
function bar(low: number, high: number, volume: number, time = 0): CoinGlassPriceBar {
  return {
    time,
    open: String(low),
    high: String(high),
    low: String(low),
    close: String(high),
    volume_usd: String(volume),
  };
}

/**
 * 一份筹码集中在 [100, 110]、两侧各有一点稀薄成交的分布。
 * 价值区应该落在中间那一坨里，VAL 接近 100、VAH 接近 110。
 */
function concentratedBars(): CoinGlassPriceBar[] {
  const bars: CoinGlassPriceBar[] = [];
  for (let i = 0; i < 40; i++) bars.push(bar(100, 110, 1000, i));
  bars.push(bar(60, 100, 5, 100));
  bars.push(bar(110, 150, 5, 101));
  return bars;
}

describe("buildVolumeProfile", () => {
  it("价值区落在筹码密集处，而不是整个价格全域", () => {
    const p = buildVolumeProfile(concentratedBars())!;
    expect(p.val).toBeGreaterThan(95);
    expect(p.vah).toBeLessThan(115);
    expect(p.poc).toBeGreaterThanOrEqual(p.val);
    expect(p.poc).toBeLessThanOrEqual(p.vah);
  });

  it("K 线不足时返回 null，让上层走中性分而不是拿一个假的价值区打分", () => {
    expect(buildVolumeProfile([bar(1, 2, 10)])).toBeNull();
    expect(buildVolumeProfile([])).toBeNull();
  });

  it("全域为零宽（所有 K 线同价）时返回 null，避免除零", () => {
    const flat = Array.from({ length: 40 }, (_, i) => bar(5, 5, 100, i));
    expect(buildVolumeProfile(flat)).toBeNull();
  });
});

describe("zonePosition", () => {
  const profile = { poc: 105, val: 100, vah: 110 };

  it("贴 VAL 是 0，贴 VAH 是 1", () => {
    expect(zonePosition(100, profile)).toBeCloseTo(0);
    expect(zonePosition(110, profile)).toBeCloseTo(1);
  });

  it("跌破 VAL 是负数，冲出 VAH 大于 1", () => {
    expect(zonePosition(95, profile)).toBeCloseTo(-0.5);
    expect(zonePosition(115, profile)).toBeCloseTo(1.5);
  });
});

describe("zoneScore 曲线拐点", () => {
  const bars = concentratedBars();
  // 用真实 profile 反推出目标 pos 对应的价格，避免测试依赖桶边界的具体取值
  const p = buildVolumeProfile(bars)!;
  const at = (pos: number) => p.val + pos * (p.vah - p.val);

  it("pos 在 [0, 0.35] 平台上给满分 30", () => {
    expect(zoneScore(at(0), bars, "long")).toBeCloseTo(30, 5);
    expect(zoneScore(at(0.35), bars, "long")).toBeCloseTo(30, 5);
  });

  it("pos = 0.7 降到 12", () => {
    expect(zoneScore(at(0.7), bars, "long")).toBeCloseTo(12, 5);
  });

  it("pos = 1.0 降到 4", () => {
    expect(zoneScore(at(1), bars, "long")).toBeCloseTo(4, 5);
  });

  it("冲出 VAH 之后固定 4 分——已离开筹码区，做多就是追高", () => {
    expect(zoneScore(at(1.5), bars, "long")).toBeCloseTo(4, 5);
    expect(zoneScore(at(5), bars, "long")).toBeCloseTo(4, 5);
  });

  it("跌破 VAL 从 30 线性衰减，到 ZONE_BREAKDOWN_ZERO_AT 归零", () => {
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT / 2), bars, "long")).toBeCloseTo(15, 5);
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT), bars, "long")).toBeCloseTo(0, 5);
    expect(zoneScore(at(ZONE_BREAKDOWN_ZERO_AT * 2), bars, "long")).toBeCloseTo(0, 5);
  });

  it("做空是把 pos 换成 1-pos 走同一条曲线", () => {
    expect(zoneScore(at(1), bars, "short")).toBeCloseTo(30, 5);
    expect(zoneScore(at(0.3), bars, "short")).toBeCloseTo(zoneScore(at(0.7), bars, "long"), 5);
  });

  it("数据不足时给中性 15，不给 0 也不给满分", () => {
    expect(zoneScore(100, [bar(1, 2, 10)], "long")).toBe(15);
  });

  it("分数恒在 [0, 30]", () => {
    for (const pos of [-3, -0.5, 0, 0.5, 1, 3]) {
      for (const dir of ["long", "short"] as const) {
        const v = zoneScore(at(pos), bars, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/factors/zone.test.ts`
Expected: FAIL，`Failed to resolve import "./zone"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/factors/zone.ts`：

```ts
import type { CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** 价格全域切多少个桶。50 个桶在 7 天区间上大约是 2% 一档，够分辨价值区边沿。 */
export const ZONE_BUCKETS = 50;

/** 价值区包含的成交额比例。70% 是 Market Profile 的通用定义。 */
export const VALUE_AREA_RATIO = 0.7;

/**
 * 跌破 VAL 之后分数归零的位置。
 *
 * 这是全套四因子里唯一的「接飞刀」风险敞口，所以单独抽成常量：
 * 刚跌破价值区经常是假破（分数仍高，允许抄底），但破到半个价值区宽度之外
 * 说明结构已经坏了，再给分就是在鼓励接刀。要调松紧改这一个数。
 */
export const ZONE_BREAKDOWN_ZERO_AT = -0.5;

/** K 线少于这个数就不算分布——样本太少的「密集区」只是噪音。 */
const MIN_BARS = 24;

export interface VolumeProfile {
  poc: number;
  val: number;
  vah: number;
}

/**
 * 把 7 天的成交额按价格分桶，找出 POC 与 70% 价值区。
 *
 * 每根 K 线的成交额均摊到它 low..high 覆盖的所有桶里，而不是只记在收盘价那一档：
 * 一根穿过 10 个桶的长实体，它的成交显然发生在这一整段上，全算给收盘价
 * 会让分布被最后一根 K 线的收盘位置牵着走。
 */
export function buildVolumeProfile(bars: CoinGlassPriceBar[]): VolumeProfile | null {
  if (bars.length < MIN_BARS) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    const low = parseFloat(b.low);
    const high = parseFloat(b.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    if (low < min) min = low;
    if (high > max) max = high;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  const width = (max - min) / ZONE_BUCKETS;
  const buckets = new Array<number>(ZONE_BUCKETS).fill(0);

  for (const b of bars) {
    const low = parseFloat(b.low);
    const high = parseFloat(b.high);
    const vol = parseFloat(b.volume_usd);
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(vol) || vol <= 0) continue;

    const from = Math.min(ZONE_BUCKETS - 1, Math.max(0, Math.floor((low - min) / width)));
    const to = Math.min(ZONE_BUCKETS - 1, Math.max(0, Math.floor((high - min) / width)));
    const span = to - from + 1;
    const share = vol / span;
    for (let i = from; i <= to; i++) buckets[i] += share;
  }

  const total = buckets.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  let pocIndex = 0;
  for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[pocIndex]) pocIndex = i;

  // 从 POC 向两侧扩张，每一步吞掉相邻两侧中成交额更大的那一格，直到覆盖 70%
  let lo = pocIndex;
  let hi = pocIndex;
  let acc = buckets[pocIndex];
  const target = total * VALUE_AREA_RATIO;
  while (acc < target && (lo > 0 || hi < ZONE_BUCKETS - 1)) {
    const below = lo > 0 ? buckets[lo - 1] : -1;
    const above = hi < ZONE_BUCKETS - 1 ? buckets[hi + 1] : -1;
    if (above >= below) {
      hi++;
      acc += buckets[hi];
    } else {
      lo--;
      acc += buckets[lo];
    }
  }

  return {
    poc: min + (pocIndex + 0.5) * width,
    val: min + lo * width,
    vah: min + (hi + 1) * width,
  };
}

/** 现价相对价值区的位置。0 = 贴 VAL，1 = 贴 VAH，可以小于 0 或大于 1。 */
export function zonePosition(price: number, profile: VolumeProfile): number {
  const span = profile.vah - profile.val;
  if (span <= 0) return 0.5;
  return (price - profile.val) / span;
}

/**
 * 做多打分曲线（做空把 pos 换成 1-pos 走同一条）：
 *
 *   [0, 0.35]  → 30   贴价值区下沿，密集筹码就在脚下当支撑
 *   (0.35,0.7] → 30→12 区间中部，无位置优势
 *   (0.7, 1.0] → 12→4  贴上沿，头顶是套牢盘
 *   > 1        → 4     已冲出筹码区，做多即追高
 *   < 0        → 30→0  见 ZONE_BREAKDOWN_ZERO_AT
 */
function curve(pos: number): number {
  if (pos > 1) return 4;
  if (pos >= 0.7) return 12 - ((pos - 0.7) / 0.3) * 8;
  if (pos >= 0.35) return 30 - ((pos - 0.35) / 0.35) * 18;
  if (pos >= 0) return 30;
  const t = pos / ZONE_BREAKDOWN_ZERO_AT; // pos 越负 t 越接近 1
  return t >= 1 ? 0 : 30 * (1 - t);
}

/**
 * 数据不足给中性 15（满分的一半）而不是 0：Zone 是「价格现在处在什么位置」
 * 这种状态型因子，拿不到 K 线不等于位置很差。这跟 Sweep 那种事件型因子
 * 「没数据 = 没发生 = 0 分」的语义相反，两者不要互相看齐。
 */
export function zoneScore(
  price: number,
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  const profile = buildVolumeProfile(bars);
  if (!profile || !Number.isFinite(price)) return FACTOR_MAX.zone / 2;
  const pos = zonePosition(price, profile);
  const eff = direction === "long" ? pos : 1 - pos;
  return Math.max(0, Math.min(FACTOR_MAX.zone, curve(eff)));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/factors/zone.test.ts`
Expected: PASS，13 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/factors/zone.ts src/lib/screener/factors/zone.test.ts
git commit -m "feat(screener): Zone 因子——成交量分布价值区

每根 K 线的成交额均摊到它 low..high 覆盖的所有桶，而不是只记在收盘价
那一档：一根穿过 10 个桶的长实体，成交显然发生在这一整段上，全算给
收盘价会让整个分布被最后一根 K 线的收盘位置牵着走。

跌破 VAL 的衰减终点抽成 ZONE_BREAKDOWN_ZERO_AT 常量——这是四个因子里
唯一的接飞刀风险敞口，要调松紧只该改这一个数。

数据不足给中性 15 而不是 0：Zone 是状态型因子，拿不到 K 线不等于位置差。
这与 Sweep 事件型因子的缺失语义相反，两者不要互相看齐。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Sweep 因子（爆仓峰值 + 价格收回）

**Files:**
- Create: `src/lib/screener/factors/sweep.ts`
- Test: `src/lib/screener/factors/sweep.test.ts`

**Interfaces:**
- Consumes: `CoinGlassLiquidationBar`、`CoinGlassPriceBar`；`Direction`、`FACTOR_MAX`
- Produces:
  - `sweepScore(liq: CoinGlassLiquidationBar[], bars: CoinGlassPriceBar[], direction: Direction): number` —— 0–20
  - `spikeRatio(series: number[]): { ratio: number; index: number }`
  - `SWEEP_SPIKE_MIN = 3`、`SWEEP_SPIKE_FULL = 10`、`SWEEP_RECENT_BARS = 4`、`SWEEP_BASELINE_FLOOR_USD = 1000`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/factors/sweep.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { sweepScore, spikeRatio, SWEEP_SPIKE_MIN } from "./sweep";
import type { CoinGlassLiquidationBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

function liqSeries(longs: number[], shorts: number[]): CoinGlassLiquidationBar[] {
  return longs.map((l, i) => ({
    time: i * 1_800_000,
    long_liquidation_usd: String(l),
    short_liquidation_usd: String(shorts[i] ?? 0),
  }));
}

/** 一根有长下影且已收回的 K 线：low 远低于实体，close 在上半段 */
function hammer(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "101", low: "90", close: "100.5", volume_usd: "1000" };
}

/** 一根普通的小实体 K 线，几乎没有影线 */
function doji(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "100.4", low: "99.8", close: "100.2", volume_usd: "1000" };
}

/** 一根有长上影且已回落的 K 线 */
function shootingStar(i: number): CoinGlassPriceBar {
  return { time: i * 1_800_000, open: "100", high: "112", low: "99.5", close: "100.2", volume_usd: "1000" };
}

const FLAT = Array.from({ length: 48 }, (_, i) => doji(i));

describe("spikeRatio", () => {
  it("中位数为 0 时不返回 Infinity", () => {
    const { ratio } = spikeRatio([0, 0, 0, 0, 0, 0, 500]);
    expect(Number.isFinite(ratio)).toBe(true);
  });

  it("把峰值所在下标一起返回，供收回确认定位那根 K 线", () => {
    const { index } = spikeRatio([10, 10, 900, 10]);
    expect(index).toBe(2);
  });

  it("用中位数而不是均值当基线——均值会被峰值自己抬上去", () => {
    // 中位数 = 10000，均值 ≈ 122500。用中位数算 spike 是 90，用均值只有 7.3。
    // 数值量级必须高于 SWEEP_BASELINE_FLOOR_USD(1000)，否则基线被下限钳住，
    // 这条用例什么也测不出来。
    const { ratio } = spikeRatio([10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 900_000]);
    expect(ratio).toBeGreaterThan(50);
  });
});

describe("sweepScore", () => {
  const flatLiq = liqSeries(Array(48).fill(1000), Array(48).fill(1000));

  it("没有任何爆仓数据给 0 分，而不是中性分——事件型因子没发生就是没发生", () => {
    expect(sweepScore([], FLAT, "long")).toBe(0);
  });

  it("整条序列全 0 也给接近 0 分，不因除零变满分", () => {
    const zeros = liqSeries(Array(48).fill(0), Array(48).fill(0));
    expect(sweepScore(zeros, FLAT, "long")).toBeLessThan(1);
  });

  it("爆仓平淡时接近 0 分", () => {
    expect(sweepScore(flatLiq, FLAT, "long")).toBeLessThan(1);
  });

  it("多头爆仓放量 + 长下影收回 → 做多高分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeGreaterThan(14);
  });

  it("同一次多头爆仓对做空不给分——方向必须对上", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "short")).toBeLessThan(2);
  });

  it("空头爆仓放量 + 长上影回落 → 做空高分", () => {
    const shorts = Array(48).fill(1000);
    shorts[46] = 50_000;
    const bars = FLAT.slice();
    bars[46] = shootingStar(46);
    expect(sweepScore(liqSeries(Array(48).fill(1000), shorts), bars, "short")).toBeGreaterThan(14);
  });

  it("有爆仓峰值但价格没收回时只拿到峰值分，拿不到确认分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 50_000;
    const noRecover = FLAT.slice();
    // 收在最低点附近 = 没有收回
    noRecover[46] = { time: 46, open: "100", high: "100.2", low: "90", close: "90.1", volume_usd: "1000" };
    const score = sweepScore(liqSeries(longs, Array(48).fill(1000)), noRecover, "long");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(12);
  });

  it("峰值发生在两小时之前不算数——sweep 是个短命事件", () => {
    const longs = Array(48).fill(1000);
    longs[10] = 50_000;
    const bars = FLAT.slice();
    bars[10] = hammer(10);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeLessThan(2);
  });

  it("低于起分线的峰值不给分", () => {
    const longs = Array(48).fill(1000);
    longs[46] = 1000 * (SWEEP_SPIKE_MIN - 0.5);
    const bars = FLAT.slice();
    bars[46] = hammer(46);
    expect(sweepScore(liqSeries(longs, Array(48).fill(1000)), bars, "long")).toBeLessThan(8);
  });

  it("分数恒在 [0, 20]", () => {
    const longs = Array(48).fill(1);
    longs[47] = 10_000_000;
    const bars = FLAT.slice();
    bars[47] = hammer(47);
    const v = sweepScore(liqSeries(longs, Array(48).fill(1)), bars, "long");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/factors/sweep.test.ts`
Expected: FAIL，`Failed to resolve import "./sweep"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/factors/sweep.ts`：

```ts
import type { CoinGlassLiquidationBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** 峰值达到基线的几倍才开始给分 */
export const SWEEP_SPIKE_MIN = 3;

/** 峰值达到基线的几倍拿满峰值分 */
export const SWEEP_SPIKE_FULL = 10;

/** 只看最近几根 30 分钟——sweep 是个生命周期几十分钟的事件，两小时之前的不算数 */
export const SWEEP_RECENT_BARS = 4;

/**
 * 基线的绝对下限，美元。
 *
 * 小市值币的 48 根 30m 爆仓序列里超过一半是 0 是常态，中位数因此经常正好为 0，
 * 直接相除会得到 Infinity，让任何一笔几百美元的爆仓拿满分。
 * 实际用的基线：中位数非 0 时取中位数，中位数为 0 时才回落到「总额/根数」（均值），
 * 最后再与这个绝对下限取较大者。**中位数非 0 时绝不能再与均值取 max** ——
 * 只要序列里有峰值均值就必然大于中位数，那样中位数永远不生效，
 * 整条曲线会退化成它本来要避免的「用均值当基线」。
 */
export const SWEEP_BASELINE_FLOOR_USD = 1000;

/** 峰值强度分上限（满分 20 里的 12） */
const SPIKE_MAX = 12;

/** 收回确认分上限（满分 20 里的 8） */
const RECOVER_MAX = 8;

/** 下影/上影至少要占全长这么多才算「插针」 */
const WICK_MIN_RATIO = 0.4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 最近 SWEEP_RECENT_BARS 根里的最大值相对全序列基线的倍数，以及它的下标。
 * 基线用中位数而不是均值：峰值会把均值自己抬上去，一次 90 倍的插针
 * 用均值算出来只有 7 倍，正好被起分线挡在门外。
 */
export function spikeRatio(series: number[]): { ratio: number; index: number } {
  if (series.length === 0) return { ratio: 0, index: -1 };

  const total = series.reduce((a, b) => a + b, 0);
  const med = median(series);
  // 中位数为 0 才回落到均值：小市值币的 48 根序列里过半是 0 是常态，
  // 那种情况下中位数不携带任何信息，用均值让门槛随该币自身的爆仓体量缩放。
  // 但中位数非 0 时**绝不能**再和均值取 max —— 只要序列里有峰值，
  // 均值必然大于中位数，max 会永远取到均值，这条曲线就退化成了
  // 它本来要避免的「用均值当基线」，一次 90 倍的插针会被算成 7 倍。
  const scale = med > 0 ? med : total / series.length;
  const baseline = Math.max(scale, SWEEP_BASELINE_FLOOR_USD);

  const from = Math.max(0, series.length - SWEEP_RECENT_BARS);
  let index = from;
  for (let i = from + 1; i < series.length; i++) if (series[i] > series[index]) index = i;

  return { ratio: series[index] / baseline, index };
}

/** spike 从 SWEEP_SPIKE_MIN 起给分、SWEEP_SPIKE_FULL 满分，中间走对数刻度。 */
function spikeToScore(ratio: number): number {
  if (ratio <= SWEEP_SPIKE_MIN) return 0;
  if (ratio >= SWEEP_SPIKE_FULL) return SPIKE_MAX;
  const t =
    (Math.log(ratio) - Math.log(SWEEP_SPIKE_MIN)) /
    (Math.log(SWEEP_SPIKE_FULL) - Math.log(SWEEP_SPIKE_MIN));
  return t * SPIKE_MAX;
}

/**
 * 收回确认：峰值那根 K 线要有足够长的顺向影线，且收盘已经离开影线尖端。
 * 做多看下影（下方止损被扫干净后价格收回），做空看上影。
 */
function recoverScore(bar: CoinGlassPriceBar | undefined, direction: Direction): number {
  if (!bar) return 0;
  const high = parseFloat(bar.high);
  const low = parseFloat(bar.low);
  const open = parseFloat(bar.open);
  const close = parseFloat(bar.close);
  if (![high, low, open, close].every(Number.isFinite)) return 0;

  const range = high - low;
  if (range <= 0) return 0;

  const bodyLow = Math.min(open, close);
  const bodyHigh = Math.max(open, close);
  const wick = direction === "long" ? (bodyLow - low) / range : (high - bodyHigh) / range;
  if (wick < WICK_MIN_RATIO) return 0;

  // 收盘在整根区间里的位置：做多要靠上，做空要靠下
  const closePos = (close - low) / range;
  const recovered = direction === "long" ? closePos : 1 - closePos;
  if (recovered < 0.5) return 0;

  const wickPart = Math.min(1, (wick - WICK_MIN_RATIO) / (1 - WICK_MIN_RATIO));
  const recoverPart = (recovered - 0.5) / 0.5;
  return RECOVER_MAX * (0.5 * wickPart + 0.5 * recoverPart);
}

/**
 * 「没数据」与「真的是 0」在 Sweep 上语义相同，都给 0 分。
 *
 * 它是「发生了某件事」的事件型因子，没发生就是没发生。这与 Zone/OI/CVD
 * 那种「拿不到数据走中性分」的状态型因子**正好相反**——不要为了统一
 * 而把这里也改成中性分，那会让一批完全没有扫单的币白拿 10 分。
 */
export function sweepScore(
  liq: CoinGlassLiquidationBar[],
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  if (liq.length === 0) return 0;

  const series = liq.map((b) =>
    parseFloat(direction === "long" ? b.long_liquidation_usd : b.short_liquidation_usd)
  );
  if (series.some((v) => !Number.isFinite(v))) return 0;

  const { ratio, index } = spikeRatio(series);
  const spikePart = spikeToScore(ratio);
  if (spikePart <= 0) return 0;

  // 爆仓序列与 K 线序列都取自同一交易所、同一 30m 粒度、同样 48 根，
  // 所以下标可以直接对齐；长度不一致时按「距末尾多少根」对齐更稳。
  const offsetFromEnd = series.length - 1 - index;
  const bar = bars[bars.length - 1 - offsetFromEnd];

  return Math.max(0, Math.min(FACTOR_MAX.sweep, spikePart + recoverScore(bar, direction)));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/factors/sweep.test.ts`
Expected: PASS，14 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/factors/sweep.ts src/lib/screener/factors/sweep.test.ts
git commit -m "feat(screener): Sweep 因子——爆仓峰值 + 价格收回

基线用中位数而不是均值：峰值会把均值自己抬上去，一次 90 倍的插针
用均值算出来只有 7 倍，正好被起分线挡在门外。

中位数为 0 时才回落到均值，最后与 1000 美元下限取最大。小市值币的 48 根
爆仓序列里过半是 0 是常态，中位数经常正好为 0，直接相除得到 Infinity，
会让任何一笔几百美元的爆仓拿满分。中位数非 0 时不能再和均值取 max，
否则均值恒大、中位数永远不生效。

缺数据与真的是 0 在这里语义相同、都给 0 分。Sweep 是事件型因子，
没发生就是没发生——不要为了跟 Zone/OI/CVD 统一而改成中性分，
那会让一批完全没有扫单的币白拿 10 分。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: OI 因子（持仓量 × 价格四象限）

**Files:**
- Create: `src/lib/screener/factors/oi.ts`
- Test: `src/lib/screener/factors/oi.test.ts`

**Interfaces:**
- Consumes: `CoinGlassOpenInterestRow`、`CoinGlassPriceBar`；`Direction`、`FACTOR_MAX`
- Produces:
  - `priceChangeOverBars(bars: CoinGlassPriceBar[], barsBack: number): number | null` —— 返回百分比
  - `quadrantScore(oiPct: number, pricePct: number, direction: Direction): number` —— 0–100
  - `oiScore(oi: CoinGlassOpenInterestRow | undefined, bars: CoinGlassPriceBar[], direction: Direction): number` —— 0–30
  - `OI_DEADZONE_PCT = 0.5`、`PRICE_DEADZONE_PCT = 0.3`、`OI_FULL_STRENGTH_PCT = 2`、`OI_WINDOWS`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/factors/oi.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { oiScore, quadrantScore, priceChangeOverBars, OI_DEADZONE_PCT, PRICE_DEADZONE_PCT } from "./oi";
import type { CoinGlassOpenInterestRow, CoinGlassPriceBar } from "@/lib/coinglass/types";

/** 造一段 30m K 线，收盘价按给定序列走 */
function barsFromCloses(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c * 1.001),
    low: String(c * 0.999),
    close: String(c),
    volume_usd: "1000",
  }));
}

function oiRow(p30m: number, p1h: number, p4h: number): CoinGlassOpenInterestRow {
  return {
    exchange: "All",
    symbol: "TIA",
    open_interest_usd: 1_000_000,
    open_interest_change_percent_5m: 0,
    open_interest_change_percent_15m: 0,
    open_interest_change_percent_30m: p30m,
    open_interest_change_percent_1h: p1h,
    open_interest_change_percent_4h: p4h,
    open_interest_change_percent_24h: 0,
  };
}

describe("priceChangeOverBars", () => {
  it("按「多少根之前」算涨跌百分比", () => {
    // 100 → 110，两根之前
    expect(priceChangeOverBars(barsFromCloses([100, 105, 110]), 2)).toBeCloseTo(10);
  });

  it("K 线不够长时返回 null，而不是拿最早那根凑数", () => {
    expect(priceChangeOverBars(barsFromCloses([100, 110]), 8)).toBeNull();
  });
});

describe("quadrantScore", () => {
  it("OI 涨 + 价涨 = 新多头进场，做多满分、做空 0", () => {
    expect(quadrantScore(5, 5, "long")).toBe(100);
    expect(quadrantScore(5, 5, "short")).toBe(0);
  });

  it("OI 涨 + 价跌 = 新空头进场，做空满分、做多 0", () => {
    expect(quadrantScore(5, -5, "short")).toBe(100);
    expect(quadrantScore(5, -5, "long")).toBe(0);
  });

  it("OI 跌 + 价涨 = 空头回补，两边都只给中低分", () => {
    expect(quadrantScore(-5, 5, "long")).toBe(40);
    expect(quadrantScore(-5, 5, "short")).toBe(30);
  });

  it("OI 跌 + 价跌 = 多头离场，两边都只给中低分", () => {
    expect(quadrantScore(-5, -5, "long")).toBe(30);
    expect(quadrantScore(-5, -5, "short")).toBe(40);
  });

  it("OI 变化落在死区内给中性 50——微小变化的正负号是噪音不是象限", () => {
    expect(quadrantScore(OI_DEADZONE_PCT / 2, 5, "long")).toBe(50);
  });

  it("价格变化落在死区内同样给中性 50", () => {
    expect(quadrantScore(5, PRICE_DEADZONE_PCT / 2, "long")).toBe(50);
  });

  it("OI 变化越小越向 50 收缩", () => {
    const weak = quadrantScore(0.6, 5, "long");
    const strong = quadrantScore(5, 5, "long");
    expect(weak).toBeLessThan(strong);
    expect(weak).toBeGreaterThan(50);
  });
});

describe("oiScore", () => {
  const rising = barsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i));

  it("拿不到聚合行给中性 15", () => {
    expect(oiScore(undefined, rising, "long")).toBe(15);
  });

  it("三个窗口 OI 齐涨 + 价格齐涨 → 做多接近满分", () => {
    expect(oiScore(oiRow(5, 5, 5), rising, "long")).toBeGreaterThan(27);
  });

  it("同样的数据对做空接近 0", () => {
    expect(oiScore(oiRow(5, 5, 5), rising, "short")).toBeLessThan(3);
  });

  it("短窗口权重高于长窗口——15 分钟扫描要抓的是刚发生的资金动作", () => {
    const shortWindowBull = oiScore(oiRow(5, 0, 0), rising, "long");
    const longWindowBull = oiScore(oiRow(0, 0, 5), rising, "long");
    expect(shortWindowBull).toBeGreaterThan(longWindowBull);
  });

  it("分数恒在 [0, 30]", () => {
    for (const row of [oiRow(50, 50, 50), oiRow(-50, -50, -50), oiRow(0, 0, 0)]) {
      for (const dir of ["long", "short"] as const) {
        const v = oiScore(row, rising, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/factors/oi.test.ts`
Expected: FAIL，`Failed to resolve import "./oi"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/factors/oi.ts`：

```ts
import type { CoinGlassOpenInterestRow, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";

/** OI 变化小于这个百分比就认为没有方向，该窗口给中性分 */
export const OI_DEADZONE_PCT = 0.5;

/** 价格变化小于这个百分比同样认为没有方向 */
export const PRICE_DEADZONE_PCT = 0.3;

/** OI 变化达到这个百分比时象限分完全生效，不再向中性收缩 */
export const OI_FULL_STRENGTH_PCT = 2;

/**
 * 三个时间窗口及其权重。
 *
 * 刻意丢掉了端点提供的 5m 与 15m —— 没有对应粒度的价格数据可以配对
 * （Startup 套餐 K 线最小 30m），单看 OI 变化无法判断象限。
 * 短窗口权重更高是因为这是个 15 分钟一扫的扫描器，要抓的是刚发生的资金动作。
 */
export const OI_WINDOWS = [
  { key: "open_interest_change_percent_30m", barsBack: 1, weight: 0.4 },
  { key: "open_interest_change_percent_1h", barsBack: 2, weight: 0.35 },
  { key: "open_interest_change_percent_4h", barsBack: 8, weight: 0.25 },
] as const;

/** 用收盘价算「barsBack 根之前到现在」的涨跌百分比。K 线不够长返回 null。 */
export function priceChangeOverBars(
  bars: CoinGlassPriceBar[],
  barsBack: number
): number | null {
  if (bars.length <= barsBack) return null;
  const now = parseFloat(bars[bars.length - 1].close);
  const then = parseFloat(bars[bars.length - 1 - barsBack].close);
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  return ((now - then) / then) * 100;
}

/**
 * 四象限：
 *
 *   OI↑ 价↑  新多头进场，涨势有新钱   → 做多 100 / 做空 0
 *   OI↑ 价↓  新空头进场               → 做多 0   / 做空 100
 *   OI↓ 价↑  空头回补，涨得没新钱     → 做多 40  / 做空 30
 *   OI↓ 价↓  多头平仓离场             → 做多 30  / 做空 40
 *
 * 后两个象限两边都只给中低分是刻意的：减仓行情说明这一波没有新资金，
 * 无论往哪个方向做都缺乏推动力，不该因为「价格在涨」就奖励做多。
 */
export function quadrantScore(
  oiPct: number,
  pricePct: number,
  direction: Direction
): number {
  if (!Number.isFinite(oiPct) || !Number.isFinite(pricePct)) return 50;
  if (Math.abs(oiPct) < OI_DEADZONE_PCT) return 50;
  if (Math.abs(pricePct) < PRICE_DEADZONE_PCT) return 50;

  const oiUp = oiPct > 0;
  const priceUp = pricePct > 0;

  let raw: number;
  if (oiUp && priceUp) raw = direction === "long" ? 100 : 0;
  else if (oiUp && !priceUp) raw = direction === "long" ? 0 : 100;
  else if (!oiUp && priceUp) raw = direction === "long" ? 40 : 30;
  else raw = direction === "long" ? 30 : 40;

  // 变化越小越靠近中性：0.5% 的 OI 变动和 5% 的 OI 变动不该给同一个象限分
  const strength = Math.min(1, Math.abs(oiPct) / OI_FULL_STRENGTH_PCT);
  return 50 + (raw - 50) * strength;
}

/**
 * 拿不到聚合行给中性 15（满分一半）。OI 是「当前杠杆水位在怎么变」的状态型因子，
 * 请求失败不等于杠杆没在动 —— 给 0 会让一次上游抖动直接把这个币踢出榜单。
 * 这与 Sweep 事件型因子的缺失语义相反。
 */
export function oiScore(
  oi: CoinGlassOpenInterestRow | undefined,
  bars: CoinGlassPriceBar[],
  direction: Direction
): number {
  if (!oi) return FACTOR_MAX.oi / 2;

  let weighted = 0;
  let usedWeight = 0;

  for (const w of OI_WINDOWS) {
    const oiPct = oi[w.key];
    const pricePct = priceChangeOverBars(bars, w.barsBack);
    // 价格窗口取不到就跳过这个窗口，而不是当成 0 —— 当成 0 会落进价格死区
    // 拿中性 50，等于用一个假数据稀释掉另外两个真窗口。
    if (typeof oiPct !== "number" || pricePct === null) continue;
    weighted += quadrantScore(oiPct, pricePct, direction) * w.weight;
    usedWeight += w.weight;
  }

  if (usedWeight === 0) return FACTOR_MAX.oi / 2;

  const normalized = weighted / usedWeight; // 0–100
  return Math.max(0, Math.min(FACTOR_MAX.oi, (normalized / 100) * FACTOR_MAX.oi));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/factors/oi.test.ts`
Expected: PASS，14 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/factors/oi.ts src/lib/screener/factors/oi.test.ts
git commit -m "feat(screener): OI 因子——持仓量 × 价格四象限

刻意丢掉端点提供的 5m 与 15m 窗口：Startup 套餐 K 线最小 30m，
没有对应粒度的价格数据可以配对，单看 OI 变化无法判断象限。

减仓的两个象限两边都只给中低分是刻意的——减仓说明这一波没有新资金，
无论往哪个方向做都缺乏推动力，不该因为价格在涨就奖励做多。

某个窗口的价格取不到时跳过该窗口而不是当成 0：当成 0 会落进价格死区
拿中性 50，等于用一个假数据稀释掉另外两个真窗口。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: CVD 因子（累积主动买卖差 + 背离）

**Files:**
- Create: `src/lib/screener/factors/cvd.ts`
- Test: `src/lib/screener/factors/cvd.test.ts`

**Interfaces:**
- Consumes: `CoinGlassTakerBar`、`CoinGlassPriceBar`；`Direction`、`FACTOR_MAX`；`priceChangeOverBars`（Task 6）
- Produces:
  - `cvdNorm(bars: CoinGlassTakerBar[], window: number): number | null` —— 无量纲，落在 [-1, 1]
  - `cvdScore(taker: CoinGlassTakerBar[], price: CoinGlassPriceBar[], direction: Direction): number` —— 0–20
  - `CVD_WINDOW_BARS = 12`、`CVD_DIVERGENCE_FULL_PCT = 3`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/factors/cvd.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { cvdNorm, cvdScore, CVD_WINDOW_BARS } from "./cvd";
import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

function taker(deltas: number[], gross = 1000): CoinGlassTakerBar[] {
  // 每根总成交额固定为 gross，买卖按 delta 拆开
  return deltas.map((d, i) => ({
    time: i * 1_800_000,
    taker_buy_volume_usd: String((gross + d) / 2),
    taker_sell_volume_usd: String((gross - d) / 2),
  }));
}

function priceBars(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
    volume_usd: "1000",
  }));
}

const FLAT_PRICE = priceBars(Array.from({ length: 20 }, () => 100));
const RISING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 + i));
const FALLING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i));

describe("cvdNorm", () => {
  it("持续净买入是正数、持续净卖出是负数", () => {
    expect(cvdNorm(taker(Array(20).fill(200)), CVD_WINDOW_BARS)!).toBeGreaterThan(0);
    expect(cvdNorm(taker(Array(20).fill(-200)), CVD_WINDOW_BARS)!).toBeLessThan(0);
  });

  it("买卖持平时接近 0", () => {
    expect(Math.abs(cvdNorm(taker(Array(20).fill(0)), CVD_WINDOW_BARS)!)).toBeLessThan(0.05);
  });

  it("恒在 [-1, 1]——分母是同期换手总量，不受币的绝对体量影响", () => {
    for (const d of [1000, -1000, 999999, -999999]) {
      const v = cvdNorm(taker(Array(20).fill(d), 1000), CVD_WINDOW_BARS)!;
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("样本不足返回 null", () => {
    expect(cvdNorm(taker([100, 100]), CVD_WINDOW_BARS)).toBeNull();
    expect(cvdNorm([], CVD_WINDOW_BARS)).toBeNull();
  });
});

describe("cvdScore", () => {
  it("数据缺失给方向分中性 5、背离分 0，合计 5", () => {
    expect(cvdScore([], FLAT_PRICE, "long")).toBe(5);
    expect(cvdScore(taker(Array(20).fill(100)), [], "long")).toBe(5);
  });

  it("价格下跌但 CVD 上行 = 跌中承接，背离分在方向分之上再叠一大块", () => {
    const flow = taker(Array(20).fill(800));
    // 同一份资金流，只改价格走势：逆行时才拿得到背离分，走平时拿不到。
    // 用差值而不是绝对阈值断言，测的才是「背离分真的在加分」这条性质本身。
    // （原来这条用例叫「背离满分」是错的：flowLeg = |norm| = 0.8，
    //  背离分实际只有 8/10，要真打满得让主动卖为 0，那是个退化输入。）
    const diverging = cvdScore(flow, FALLING_PRICE, "long");
    const flat = cvdScore(flow, FLAT_PRICE, "long");
    expect(diverging).toBeGreaterThan(flat + 5);
    // 方向分 9（norm=0.8）+ 背离分 8（priceLeg 封顶 1 × flowLeg 0.8）
    expect(diverging).toBeCloseTo(17, 5);
  });

  it("价格上涨但 CVD 下行 = 拉高出货，做空同样叠上背离分", () => {
    const flow = taker(Array(20).fill(-800));
    const diverging = cvdScore(flow, RISING_PRICE, "short");
    const flat = cvdScore(flow, FLAT_PRICE, "short");
    expect(diverging).toBeGreaterThan(flat + 5);
    expect(diverging).toBeCloseTo(17, 5);
  });

  it("同向时背离分给 0 而不是负分——同向的价值已经在方向分里算过一次", () => {
    // 价涨 + CVD 涨，做多：方向分接近满分 10，背离分 0
    const score = cvdScore(taker(Array(20).fill(800)), RISING_PRICE, "long");
    expect(score).toBeLessThanOrEqual(10.01);
    expect(score).toBeGreaterThan(8);
  });

  it("背离幅度越大分越高", () => {
    const shallow = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.02));
    const deep = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.5));
    const a = cvdScore(taker(Array(20).fill(800)), shallow, "long");
    const b = cvdScore(taker(Array(20).fill(800)), deep, "long");
    expect(b).toBeGreaterThan(a);
  });

  it("分数恒在 [0, 20]", () => {
    const cases: Array<[number[], CoinGlassPriceBar[]]> = [
      [Array(20).fill(999), RISING_PRICE],
      [Array(20).fill(-999), FALLING_PRICE],
      [Array(20).fill(0), FLAT_PRICE],
    ];
    for (const [d, p] of cases) {
      for (const dir of ["long", "short"] as const) {
        const v = cvdScore(taker(d), p, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(20);
      }
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/factors/cvd.test.ts`
Expected: FAIL，`Failed to resolve import "./cvd"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/factors/cvd.ts`：

```ts
import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";
import type { Direction } from "@/lib/screener/types";
import { FACTOR_MAX } from "@/lib/screener/types";
import { priceChangeOverBars } from "./oi";

/** 回归窗口：12 根 30 分钟 = 6 小时 */
export const CVD_WINDOW_BARS = 12;

/** 背离分打满所需的价格逆行幅度，% */
export const CVD_DIVERGENCE_FULL_PCT = 3;

/** 方向分与背离分各占满分的一半 */
const TREND_MAX = FACTOR_MAX.cvd / 2;
const DIVERGENCE_MAX = FACTOR_MAX.cvd / 2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 最近 window 根 CVD 的拟合净位移 ÷ 同期换手总量。
 *
 * 分子取「线性回归斜率 × 根数」而不是「末值 − 首值」：末值−首值只看两个端点，
 * 一根异常的收尾 K 线就能把整段趋势的符号翻过来；回归吃进全部样本。
 *
 * 分母是同期买卖成交额之和，相除得到无量纲的「净买入占总成交的比例」，
 * 天然落在 [-1, 1] 且不受币的绝对体量影响 —— 这样一个日成交 500 万的小币
 * 和一个 5 亿的大币可以用同一条曲线打分。
 */
export function cvdNorm(bars: CoinGlassTakerBar[], window: number): number | null {
  if (bars.length < window) return null;

  const slice = bars.slice(-window);
  const cvd: number[] = [];
  let running = 0;
  let gross = 0;

  for (const b of slice) {
    const buy = parseFloat(b.taker_buy_volume_usd);
    const sell = parseFloat(b.taker_sell_volume_usd);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    running += buy - sell;
    gross += buy + sell;
    cvd.push(running);
  }
  if (gross <= 0) return null;

  // 最小二乘斜率。x 取 0..n-1，均值与分母都是常量，直接展开算。
  const n = cvd.length;
  const meanX = (n - 1) / 2;
  const meanY = cvd.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (cvd[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return null;

  const slope = num / den; // USD / 根
  return clamp((slope * n) / gross, -1, 1);
}

/**
 * 背离比同向更值钱，所以单独占一半权重。
 *
 * 同向时给 0 而不是负分：同向的价值已经在方向分里表达过一次了，
 * 再给一次是重复计分；给负分则会把「趋势健康」惩罚成「不如没有信号」。
 */
function divergenceScore(norm: number, pricePct: number, direction: Direction): number {
  const wantPriceDown = direction === "long";
  const priceAgainst = wantPriceDown ? pricePct < 0 : pricePct > 0;
  const flowWith = wantPriceDown ? norm > 0 : norm < 0;
  if (!priceAgainst || !flowWith) return 0;

  const priceLeg = Math.min(1, Math.abs(pricePct) / CVD_DIVERGENCE_FULL_PCT);
  const flowLeg = Math.min(1, Math.abs(norm));
  return DIVERGENCE_MAX * priceLeg * flowLeg;
}

/**
 * 数据缺失时方向分给中性 5、背离分给 0（合计 5）。
 * CVD 的方向是状态型的（资金现在往哪边打），拿不到数据不代表方向差；
 * 但背离是事件型的（此刻正在发生一件反常的事），没证据就是没发生。
 * 一个因子内部两半用不同的缺失语义是刻意的，不要统一。
 */
export function cvdScore(
  taker: CoinGlassTakerBar[],
  price: CoinGlassPriceBar[],
  direction: Direction
): number {
  const norm = cvdNorm(taker, CVD_WINDOW_BARS);
  const pricePct = priceChangeOverBars(price, CVD_WINDOW_BARS);
  if (norm === null || pricePct === null) return TREND_MAX / 2;

  const signed = direction === "long" ? norm : -norm;
  const trend = ((signed + 1) / 2) * TREND_MAX;

  return clamp(trend + divergenceScore(norm, pricePct, direction), 0, FACTOR_MAX.cvd);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/factors/cvd.test.ts`
Expected: PASS，12 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/factors/cvd.ts src/lib/screener/factors/cvd.test.ts
git commit -m "feat(screener): CVD 因子——累积主动买卖差 + 背离

分子取回归斜率 × 根数而不是末值减首值：后者只看两个端点，一根异常的
收尾 K 线就能把整段趋势的符号翻过来。分母是同期换手总量，相除得到
无量纲的净买入占比，让日成交 500 万的小币和 5 亿的大币能用同一条曲线。

同向时背离分给 0 而不是负分：同向的价值已经在方向分里表达过一次，
再算一遍是重复计分；给负分会把趋势健康惩罚成不如没有信号。

一个因子内部两半用不同的缺失语义是刻意的——方向是状态型（给中性），
背离是事件型（没证据就是没发生，给 0）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 四因子组装与方向判定

**Files:**
- Create: `src/lib/screener/score.ts`
- Test: `src/lib/screener/score.test.ts`

**Interfaces:**
- Consumes: 四个 factor 函数；`ScannerRow`、`FactorBreakdown`、`Direction`、`FACTOR_MAX`
- Produces:
  - `ScoreInputs = { price: number; priceBars: CoinGlassPriceBar[]; liquidation: CoinGlassLiquidationBar[]; taker: CoinGlassTakerBar[]; openInterest: CoinGlassOpenInterestRow | undefined }`
  - `scoreDirection(inputs: ScoreInputs, direction: Direction): FactorBreakdown`
  - `pickDirection(inputs: ScoreInputs): { direction: Direction; total: number; factors: FactorBreakdown }`
  - `amplitudeFromBars(bars: CoinGlassPriceBar[]): number | null` —— 近 48 根的 (high-low)/low × 100

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/score.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { pickDirection, scoreDirection, amplitudeFromBars, type ScoreInputs } from "./score";
import { FACTOR_MAX } from "./types";
import type { CoinGlassPriceBar, CoinGlassTakerBar, CoinGlassLiquidationBar } from "@/lib/coinglass/types";

function priceBars(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c * 1.01),
    low: String(c * 0.99),
    close: String(c),
    volume_usd: "10000",
  }));
}

function taker(delta: number, n = 48): CoinGlassTakerBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    taker_buy_volume_usd: String((1000 + delta) / 2),
    taker_sell_volume_usd: String((1000 - delta) / 2),
  }));
}

function liq(n = 48): CoinGlassLiquidationBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 1_800_000,
    long_liquidation_usd: "1000",
    short_liquidation_usd: "1000",
  }));
}

const bullish: ScoreInputs = {
  price: 100,
  priceBars: priceBars(Array.from({ length: 60 }, (_, i) => 90 + i * 0.2)),
  liquidation: liq(),
  taker: taker(600),
  openInterest: {
    exchange: "All",
    symbol: "X",
    open_interest_usd: 1_000_000,
    open_interest_change_percent_5m: 0,
    open_interest_change_percent_15m: 0,
    open_interest_change_percent_30m: 5,
    open_interest_change_percent_1h: 5,
    open_interest_change_percent_4h: 5,
    open_interest_change_percent_24h: 5,
  },
};

describe("scoreDirection", () => {
  it("四项都落在各自的上限内", () => {
    const f = scoreDirection(bullish, "long");
    expect(f.zone).toBeLessThanOrEqual(FACTOR_MAX.zone);
    expect(f.sweep).toBeLessThanOrEqual(FACTOR_MAX.sweep);
    expect(f.oi).toBeLessThanOrEqual(FACTOR_MAX.oi);
    expect(f.cvd).toBeLessThanOrEqual(FACTOR_MAX.cvd);
  });
});

describe("pickDirection", () => {
  it("明显偏多的输入判为 long", () => {
    // 不在断言里重算总分——那等于断言「实现的公式等于我抄的这条公式」，
    // 生产代码和测试同时写错时发现不了。直接用一个方向明确的输入
    // （价格单调上行 + OI 三窗口齐涨 + 主动买压持续为正）断言行为。
    expect(pickDirection(bullish).direction).toBe("long");
  });

  it("total 恒等于取整后四项之和——扫过真的会让两条取整路径分叉的输入", () => {
    const min = Math.min(...bullish.priceBars.map((b) => parseFloat(b.low)));
    const max = Math.max(...bullish.priceBars.map((b) => parseFloat(b.high)));
    let sawDivergence = false;

    for (let t = 0; t <= 1.0001; t += 0.1) {
      for (const delta of [-870, -300, 200, 600]) {
        for (const oiPct of [-1.5, -0.4, 0.9, 5]) {
          const inputs: ScoreInputs = {
            ...bullish,
            price: min + (max - min) * t,
            taker: taker(delta),
            openInterest: {
              ...bullish.openInterest!,
              open_interest_change_percent_30m: oiPct,
              open_interest_change_percent_1h: oiPct,
              open_interest_change_percent_4h: oiPct,
            },
          };
          const picked = pickDirection(inputs);
          const raw = scoreDirection(inputs, picked.direction);
          const rawSum = raw.zone + raw.sweep + raw.oi + raw.cvd;
          const sumOfRounded =
            picked.factors.zone + picked.factors.sweep + picked.factors.oi + picked.factors.cvd;

          // 这一组输入能不能区分「先求和再取整」与「先取整再求和」
          if (Math.round(rawSum) !== sumOfRounded) sawDivergence = true;

          expect(picked.total).toBe(sumOfRounded);
        }
      }
    }

    // 没有任何一组输入让两条取整路径分叉的话，上面那条断言对 bug 版本也成立，
    // 这个用例就退化成空断言。这一条把「用例失效」本身变成一次测试失败。
    expect(sawDivergence).toBe(true);
  });

  it("总分恒在 [0, 100]，且是整数", () => {
    const p = pickDirection(bullish);
    expect(p.total).toBeGreaterThanOrEqual(0);
    expect(p.total).toBeLessThanOrEqual(100);
    expect(Number.isInteger(p.total)).toBe(true);
  });

  it("输入全空时不抛错，返回一个可用的中性结果", () => {
    const empty: ScoreInputs = {
      price: 1,
      priceBars: [],
      liquidation: [],
      taker: [],
      openInterest: undefined,
    };
    const p = pickDirection(empty);
    expect(p.total).toBeGreaterThanOrEqual(0);
    expect(p.total).toBeLessThan(100);
  });
});

describe("amplitudeFromBars", () => {
  it("按近 48 根的最高最低算振幅", () => {
    // low = 99, high = 101.01 → 约 2.03%
    expect(amplitudeFromBars(priceBars([100, 100]))!).toBeGreaterThan(1.9);
  });

  it("K 线为空返回 null", () => {
    expect(amplitudeFromBars([])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/score.test.ts`
Expected: FAIL，`Failed to resolve import "./score"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/score.ts`：

```ts
import type {
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassLiquidationBar,
  CoinGlassOpenInterestRow,
} from "@/lib/coinglass/types";
import { SERIES_LIMIT } from "@/lib/coinglass/price-history";
import type { Direction, FactorBreakdown } from "./types";
import { zoneScore } from "./factors/zone";
import { sweepScore } from "./factors/sweep";
import { oiScore } from "./factors/oi";
import { cvdScore } from "./factors/cvd";

export interface ScoreInputs {
  /** BingX 的成交价 */
  price: number;
  /** 7 天 30m K 线，同时喂 Zone / Sweep / OI / 振幅 */
  priceBars: CoinGlassPriceBar[];
  liquidation: CoinGlassLiquidationBar[];
  taker: CoinGlassTakerBar[];
  /** 已经挑好的 All 聚合行 */
  openInterest: CoinGlassOpenInterestRow | undefined;
}

export function scoreDirection(inputs: ScoreInputs, direction: Direction): FactorBreakdown {
  return {
    zone: zoneScore(inputs.price, inputs.priceBars, direction),
    sweep: sweepScore(inputs.liquidation, inputs.priceBars, direction),
    oi: oiScore(inputs.openInterest, inputs.priceBars, direction),
    cvd: cvdScore(inputs.taker, inputs.priceBars, direction),
  };
}

function sum(f: FactorBreakdown): number {
  return f.zone + f.sweep + f.oi + f.cvd;
}

/**
 * 对每个币把 long 与 short 各算一遍，方向 = 总分高的那一边。
 *
 * 方向 pill 与 0–100 总分因此由同一次计算产出，不会出现「方向说 LONG
 * 但因子构成看着像 SHORT」的矛盾。平局时取 long 只是为了让结果稳定可复现，
 * 不含任何多头偏好——平局意味着两边一样没优势，总分本身也不会高。
 *
 * 取整只在最后做：四条曲线都有平台段，先取整会让排序被浮点末位而不是
 * 真实差异决定。
 */
export function pickDirection(inputs: ScoreInputs): {
  direction: Direction;
  total: number;
  factors: FactorBreakdown;
} {
  const long = scoreDirection(inputs, "long");
  const short = scoreDirection(inputs, "short");
  const longTotal = sum(long);
  const shortTotal = sum(short);

  const isLong = longTotal >= shortTotal;
  const raw = isLong ? long : short;

  const factors = {
    zone: Math.round(raw.zone),
    sweep: Math.round(raw.sweep),
    oi: Math.round(raw.oi),
    cvd: Math.round(raw.cvd),
  };

  return {
    direction: isLong ? "long" : "short",
    // total 必须是「取整后四项之和」，不能是 Math.round(未取整总和)。
    // 后者会让 total 和 factors 走两条独立的取整路径，四个数各自的取整
    // 误差最坏累计到 2，而 types.ts 承诺这两者精确相等。
    // 注意这不违反「取整只在最后做」——那条原则针对的是方向选择与排序
    // （isLong 仍然用未取整的和比较），不是总分自身的自洽性。
    total: factors.zone + factors.sweep + factors.oi + factors.cvd,
    factors,
  };
}

/**
 * 真 24h 振幅，用近 48 根 30m K 线算。
 *
 * 不用 BingX ticker 的 highPrice/lowPrice：那一份只服务粗筛（粗筛发生在
 * 拉 K 线之前，没得选），展示与滑块过滤都该用这一份。两者会有出入，
 * 出入本身是正常的——BingX 单交易所 vs CoinGlass 选定交易所。
 */
export function amplitudeFromBars(bars: CoinGlassPriceBar[]): number | null {
  const slice = bars.slice(-SERIES_LIMIT);
  if (slice.length === 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const b of slice) {
    const h = parseFloat(b.high);
    const l = parseFloat(b.low);
    if (Number.isFinite(h) && h > high) high = h;
    if (Number.isFinite(l) && l < low) low = l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;
  return ((high - low) / low) * 100;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/score.test.ts`
Expected: PASS，7 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/score.ts src/lib/screener/score.test.ts
git commit -m "feat(screener): 四因子组装与方向判定

对每个币把 long 与 short 各算一遍、取高的那边当方向，所以方向 pill
和 0–100 总分是同一次计算的两个输出，不会出现方向说 LONG 但因子构成
看着像 SHORT 的矛盾。平局取 long 只为结果稳定可复现，不含多头偏好。

取整只在最后做：四条曲线都有平台段，先取整会让排序被浮点末位
而不是真实差异决定。

振幅用 30m K 线算而不是 BingX 的 24h 高低——后者只服务粗筛（粗筛
发生在拉 K 线之前，没得选），展示与滑块过滤都该用前者。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 资金费率挑选 + 三段式流水线

**Files:**
- Create: `src/lib/screener/funding.ts`
- Create: `src/lib/screener/pipeline.ts`
- Test: `src/lib/screener/funding.test.ts`

**Interfaces:**
- Consumes: `preselect`、`SERVER_GATE`（Task 3）；`pickDirection`、`amplitudeFromBars`（Task 8）；所有 coinglass 端点（Task 2）；`getFuturesTickers`（`@/lib/bingx/market`）；`fetchMarketCapRows`、`buildMarketCapMap`
- Produces:
  - `pickFundingRate(row: CoinGlassFundingRow | undefined, preferred: string): number | null`
  - `runScan(): Promise<ScannerPayload>`
  - `BINGX_EXCHANGE = "BingX"`、`PREFERRED_HISTORY_EXCHANGE = "Binance"`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/funding.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { pickFundingRate } from "./funding";
import type { CoinGlassFundingRow } from "@/lib/coinglass/types";

const row: CoinGlassFundingRow = {
  symbol: "TIA",
  stablecoin_margin_list: [
    { exchange: "Binance", funding_rate: 0.01 },
    { exchange: "BingX", funding_rate: 0.005 },
    { exchange: "Bybit", funding_rate: 0.03 },
  ],
};

describe("pickFundingRate", () => {
  it("优先取用户实际下单那家的费率，而不是市场平均值", () => {
    expect(pickFundingRate(row, "BingX")).toBe(0.005);
  });

  it("指定交易所没有时回落到中位数", () => {
    expect(pickFundingRate(row, "Kraken")).toBe(0.01);
  });

  it("偶数个交易所时中位数取中间两个的平均", () => {
    const two: CoinGlassFundingRow = {
      symbol: "X",
      stablecoin_margin_list: [
        { exchange: "A", funding_rate: 0.02 },
        { exchange: "B", funding_rate: 0.04 },
      ],
    };
    expect(pickFundingRate(two, "Kraken")).toBeCloseTo(0.03);
  });

  it("整行缺失返回 null 而不是 0——0 是一个真实的费率值，不能拿它当缺失", () => {
    expect(pickFundingRate(undefined, "BingX")).toBeNull();
  });

  it("列表为空返回 null", () => {
    expect(pickFundingRate({ symbol: "X", stablecoin_margin_list: [] }, "BingX")).toBeNull();
  });

  it("忽略非有限值", () => {
    const dirty: CoinGlassFundingRow = {
      symbol: "X",
      stablecoin_margin_list: [
        { exchange: "A", funding_rate: Number.NaN },
        { exchange: "B", funding_rate: 0.02 },
      ],
    };
    expect(pickFundingRate(dirty, "Kraken")).toBe(0.02);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/funding.test.ts`
Expected: FAIL，`Failed to resolve import "./funding"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/funding.ts`：

```ts
import type { CoinGlassFundingRow } from "@/lib/coinglass/types";

/**
 * 资金费率取用户实际下单那家的，不是市场平均值 —— 这是真金白银要付的数字。
 * 那家没上这个币时回落到中位数（不是均值：某个交易所报一个离谱的费率
 * 会把均值整个带偏，中位数不会）。
 *
 * 整行拿不到返回 null 而不是 0：0 是一个完全真实的费率值，
 * 拿它表示缺失会让前端把「没数据」显示成「费率为零」。
 */
export function pickFundingRate(
  row: CoinGlassFundingRow | undefined,
  preferred: string
): number | null {
  const list = row?.stablecoin_margin_list ?? [];
  const clean = list.filter((e) => Number.isFinite(e.funding_rate));
  if (clean.length === 0) return null;

  const exact = clean.find((e) => e.exchange === preferred);
  if (exact) return exact.funding_rate;

  const sorted = clean.map((e) => e.funding_rate).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
```

创建 `src/lib/screener/pipeline.ts`：

```ts
import { getFuturesTickers } from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getPairsMarkets, getFundingRateList, pickExchangeRow } from "@/lib/coinglass/market";
import { getOpenInterestExchangeList, pickAggregatedOi } from "@/lib/coinglass/open-interest";
import { getLiquidationHistory } from "@/lib/coinglass/liquidation";
import { getPriceHistory } from "@/lib/coinglass/price-history";
import { getTakerVolumeHistory } from "@/lib/coinglass/taker-volume";
import type {
  CoinGlassPairMarket,
  CoinGlassFundingRow,
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassLiquidationBar,
  CoinGlassOpenInterestRow,
} from "@/lib/coinglass/types";
import { preselect, SERVER_GATE } from "./universe";
import type { PreselectCandidate } from "./universe";
import { pickDirection, amplitudeFromBars } from "./score";
import { pickFundingRate } from "./funding";
import type { ScannerRow, ScannerPayload } from "./types";

/** 用户实际下单的交易所。价格与资金费率都取这一家。 */
export const BINGX_EXCHANGE = "BingX";

/**
 * K 线 / CVD / 爆仓时序默认取哪一家。
 * Binance 深度最好、数据最干净；这个币 Binance 没有合约时由 pickExchangeRow
 * 回落到成交额最大的那家（BingX 本身也能当 history 的 exchange 参数，实测可用）。
 */
export const PREFERRED_HISTORY_EXCHANGE = "Binance";

interface MarketStage {
  candidate: PreselectCandidate;
  /** BingX 那一行，用于展示价格 */
  bingx: CoinGlassPairMarket;
  /** 拉 history 用的交易所与合约 id */
  historyExchange: string;
  historyInstrumentId: string;
  volumeUsd: number;
  change24h: number | null;
}

/**
 * 行情层：一个币一次 pairs-markets。
 *
 * 成交额筛选放在这里而不是粗筛，因为只有 CoinGlass 的 volume_usd 是可信的
 * —— BingX 长尾的 quoteVolume 被拍平成一条 0.73M 宽的假带（516 个永续里
 * 有 144 个挤在里面）。这就是明细层必须拆成两段的全部原因。
 */
function toMarketStage(
  candidate: PreselectCandidate,
  rows: CoinGlassPairMarket[] | null
): MarketStage | null {
  if (!rows || rows.length === 0) return null;

  const bingx = rows.find((r) => r.exchange_name === BINGX_EXCHANGE);
  // BingX 那一行拿不到就整个跳过：没有它就没有可下单的价格，
  // 而这个页面唯一的出口就是跳去 BingX 下单。
  if (!bingx) return null;

  const history = pickExchangeRow(rows, PREFERRED_HISTORY_EXCHANGE);
  if (!history) return null;

  // 成交额用全交易所之和，而不是单家 —— 流动性门槛问的是「这个币好不好进出」，
  // 那是全市场的属性。
  const volumeUsd = rows.reduce((a, r) => a + (Number.isFinite(r.volume_usd) ? r.volume_usd : 0), 0);
  if (volumeUsd < SERVER_GATE.minVolumeUsd) return null;

  return {
    candidate,
    bingx,
    historyExchange: history.exchange_name,
    historyInstrumentId: history.instrument_id,
    volumeUsd,
    change24h: Number.isFinite(bingx.price_change_percent_24h)
      ? bingx.price_change_percent_24h
      : null,
  };
}

/**
 * 服务端一次算出整池榜单。
 *
 * 失败语义（与 spec 的降级矩阵一一对应）：
 *   · BingX ticker 失败或为空 → 抛错。没有可交易白名单，产出的榜单
 *     可能整片都是下不了单的币。
 *   · CoinGecko 市值失败或空 map → 抛错。这与旧的 6 维模型相反：那里
 *     市值只是 25% 权重的打分项，可以降级成中性分；这里市值是硬门槛，
 *     拿不到 = 门槛失效 = BTC/ETH 和查不到的合成品直接涌进小市值筛选器。
 *   · 资金费率整表失败 → 降级，fundingRate 全为 null。它在四因子模型里
 *     只是展示字段，不参与打分。
 *   · 单个币的单个端点失败 → runWithConcurrency 把它写成 null，
 *     对应因子走各自的缺失分支，不牵连其他币。
 */
export async function runScan(): Promise<ScannerPayload> {
  const [tickersSettled, capSettled, fundingSettled] = await Promise.allSettled([
    getFuturesTickers(),
    fetchMarketCapRows(),
    getFundingRateList(),
  ]);

  if (tickersSettled.status === "rejected") {
    throw new Error(`BingX tickers unavailable: ${String(tickersSettled.reason)}`);
  }
  const tickers = tickersSettled.value;
  if (tickers.length === 0) throw new Error("BingX tickers unavailable: empty response");

  if (capSettled.status === "rejected") {
    throw new Error(`Market cap unavailable: ${String(capSettled.reason)}`);
  }
  const marketCapMap = buildMarketCapMap(capSettled.value);
  // 空 map 必须当成失败：它是真值，会让每个币都走「查不到市值」那条路被排除，
  // 结果是一份看起来正常的空榜单被 TTL 缓存原样钉住。
  if (Object.keys(marketCapMap).length === 0) {
    throw new Error("Market cap unavailable: empty map");
  }

  const fundingByCoin = new Map<string, CoinGlassFundingRow>();
  if (fundingSettled.status === "fulfilled") {
    for (const row of fundingSettled.value) fundingByCoin.set(row.symbol, row);
  } else {
    console.error("[screener] funding rate list unavailable, degrading to null", fundingSettled.reason);
  }

  // ① 批量层粗筛
  const candidates = preselect(tickers, marketCapMap);

  // ② 行情层
  const pairRows = await runWithConcurrency(
    candidates.map((c) => () => getPairsMarkets(c.coin))
  );
  const staged = candidates
    .map((c, i) => toMarketStage(c, pairRows[i]))
    .filter((s): s is MarketStage => s !== null);

  // ③ 明细层：四个端点共用同一个并发池，所以并发上限是对上游的真实总上限
  const detailTasks: Array<() => Promise<unknown>> = [];
  for (const s of staged) {
    detailTasks.push(() => getOpenInterestExchangeList(s.candidate.coin));
    detailTasks.push(() => getPriceHistory(s.historyExchange, s.historyInstrumentId));
    detailTasks.push(() => getTakerVolumeHistory(s.historyExchange, s.historyInstrumentId));
    detailTasks.push(() => getLiquidationHistory(s.historyExchange, s.historyInstrumentId));
  }
  const detail = await runWithConcurrency(detailTasks);

  const rows: ScannerRow[] = [];
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i];
    const base = i * 4;
    const oiRows = detail[base] as CoinGlassOpenInterestRow[] | null;
    const priceBars = (detail[base + 1] as CoinGlassPriceBar[] | null) ?? [];
    const taker = (detail[base + 2] as CoinGlassTakerBar[] | null) ?? [];
    const liquidation = (detail[base + 3] as CoinGlassLiquidationBar[] | null) ?? [];

    const price = s.bingx.current_price;
    if (!Number.isFinite(price) || price <= 0) continue;

    const { direction, total, factors } = pickDirection({
      price,
      priceBars,
      taker,
      liquidation,
      openInterest: oiRows ? pickAggregatedOi(oiRows) : undefined,
    });

    rows.push({
      symbol: s.candidate.bingxSymbol,
      coin: s.candidate.coin,
      direction,
      total,
      factors,
      price,
      change24h: s.change24h,
      // K 线拿不到时退回 0：振幅只用于展示与客户端滑块过滤，
      // 0 会被任何滑块挡住，这正是「数据不全就别推荐」的正确行为。
      amplitude: amplitudeFromBars(priceBars) ?? 0,
      volumeUsd: s.volumeUsd,
      marketCap: s.candidate.marketCap,
      marketCapRank: s.candidate.marketCapRank,
      fundingRate: pickFundingRate(fundingByCoin.get(s.candidate.coin), BINGX_EXCHANGE),
      sourceExchange: s.historyExchange,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));

  return { rows, computedAt: Date.now() };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/funding.test.ts`
Expected: PASS，6 个用例全绿

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 只剩下与旧 screener 模块相关的既有错误（如果有），`src/lib/screener/` 与 `src/lib/coinglass/` 下零错误

- [ ] **Step 6: 提交**

```bash
git add src/lib/screener/funding.ts src/lib/screener/funding.test.ts src/lib/screener/pipeline.ts
git commit -m "feat(screener): 三段式扫描流水线

成交额筛选放在行情层而不是粗筛，因为只有 CoinGlass 的 volume_usd
可信——BingX 长尾的 quoteVolume 被拍平成一条 0.73M 宽的假带。
这是明细层必须拆成两段的全部原因。

CoinGecko 市值失败这次是抛错而不是降级，与旧的 6 维模型相反：那里
市值只是 25% 权重的打分项可以走中性分，这里市值是硬门槛，拿不到
等于门槛失效，BTC/ETH 和查不到的合成品会直接涌进小市值筛选器。

BingX 那一行拿不到就整个跳过这个币：没有它就没有可下单的价格，
而这个页面唯一的出口就是跳去 BingX 下单。

资金费率取 BingX 那一行、回落到中位数而不是均值；整行缺失返回 null
而不是 0——0 是一个完全真实的费率值。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 警报表与调度器

**Files:**
- Create: `supabase/migrations/048_screener_alerts.sql`
- Modify: `.github/workflows/cron-tick.yml`

**Interfaces:**
- Consumes: 无
- Produces: `public.screener_alerts` 表（字段见下）、pg_cron 任务 `screener-scan-tick`

**注意：** 这个迁移需要在 Supabase 控制台手动执行（仓库里的迁移不会自动应用，见 047 的做法）。任务完成时把这一点写进提交说明。

- [ ] **Step 1: 写迁移**

创建 `supabase/migrations/048_screener_alerts.sql`：

```sql
-- ============================================================
-- Chart-IX 数据库迁移 #048: 扫描器警报表 + 15 分钟扫描 tick
-- ============================================================
-- 背景：screener 从「每小时算一次、只出两组 Top 10」改成「每 15 分钟扫一次
-- 整池、总分首次突破 80 分时触发警报并锁价追踪」。警报必须持久化——
-- 「首次突破」这个语义要求服务端记得上一轮的状态，浏览器内的会话状态
-- 一刷新就没了，等于每个用户看到的触发时刻都不一样。
--
-- 迟滞设计写在应用层（src/lib/screener/alerts.ts）而不是这里：触发线 80、
-- 关闭线 75、连续 3 次低于关闭线才关。below_count 这一列就是为它准备的。
-- 没有迟滞的话，一个在 80 分线上抖动的币会在几十分钟内反复开关警报、
-- 反复推送 Telegram。

-- ── 1. 警报表 ────────────────────────────────────────────
create table if not exists public.screener_alerts (
  id             uuid primary key default gen_random_uuid(),
  -- BingX 永续 symbol，如 TIA-USDT。下单链接直接用它。
  symbol         text not null,
  direction      text not null check (direction in ('long','short')),
  triggered_at   timestamptz not null default now(),
  -- 触发瞬间锁定的价格，之后永不修改。累计涨跌幅全部以它为基准。
  trigger_price  numeric not null,
  trigger_score  int not null,
  -- 触发当时的四因子分 {zone,sweep,oi,cvd}，用于事后复盘「当时凭什么触发」
  factors        jsonb not null,
  last_price     numeric,
  last_price_at  timestamptz,
  -- 触发以来顺方向的最大涨跌幅（做空下跌算正）
  peak_pct       numeric,
  -- 连续低于关闭线的扫描次数。回到关闭线之上就归零。
  below_count    int not null default 0,
  closed_at      timestamptz,
  pushed_at      timestamptz
);

-- 每轮扫描都要查「这个币有没有未平警报」，这是最热的查询路径。
-- 部分索引只覆盖未平的那些行——已关闭的警报会一直累积，
-- 让它们进索引纯属浪费。
create index if not exists screener_alerts_open_idx
  on public.screener_alerts (symbol)
  where closed_at is null;

-- 警报栏按触发时间倒序列出未平警报
create index if not exists screener_alerts_open_recent_idx
  on public.screener_alerts (triggered_at desc)
  where closed_at is null;

-- ── 2. RLS ───────────────────────────────────────────────
-- 警报是全站信息（不是 per-user 数据），所有人可读；写入只走 service role。
alter table public.screener_alerts enable row level security;

drop policy if exists screener_alerts_read on public.screener_alerts;
create policy screener_alerts_read
  on public.screener_alerts
  for select
  using (true);

-- 刻意不建任何 insert/update/delete 策略：service role 绕过 RLS，
-- 其余角色一律写不进来。多写一条「仅 service role」的策略是没有意义的
-- 冗余，反而会让人以为普通角色在某些条件下可以写。

-- ── 3. 扫描 tick ─────────────────────────────────────────
-- 5 分钟一打，应用层按 15 分钟门控（src/lib/screener/types.ts 的
-- SCAN_INTERVAL_MS）。频率高于间隔是刻意的：漏掉的一轮由下一轮补上，
-- 与 036/047 给推送和早报用的是同一条原则。
DO $$
BEGIN
  PERFORM cron.unschedule('screener-scan-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- 任务本来就不存在，正是首次执行时的正常情况
END $$;

SELECT cron.schedule(
  'screener-scan-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://chart-ix.com/api/cron/screener-scan',
    -- 与 036/047 一致显式给 55 秒：pg_net 默认 5 秒，而一轮完整扫描
    -- 的墙钟预算就有约 22 秒。5 秒会把请求掐断并记成失败，
    -- 而 Vercel 那边其实已经开始跑了。
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT symbol, direction, trigger_score, triggered_at, closed_at
--     FROM public.screener_alerts ORDER BY triggered_at DESC LIMIT 20;
```

- [ ] **Step 2: 改 GitHub Actions 备份调度**

改 `.github/workflows/cron-tick.yml`：把 `- cron: "*/10 * * * *"` 改成 `- cron: "*/5 * * * *"`，并在 `Price alerts sweep` 之后追加一步：

```yaml
      - name: Screener scan
        if: always()
        run: |
          auth=()
          [ -n "$CRON_TICK_TOKEN" ] && auth=(-H "Authorization: Bearer $CRON_TICK_TOKEN")
          code=$(curl -s -o /tmp/ss.json -w "%{http_code}" --max-time 90 "${auth[@]}" \
            "https://chart-ix.com/api/cron/screener-scan")
          echo "screener-scan HTTP $code"
          cat /tmp/ss.json
          [ "$code" -lt 500 ]
```

同时把该文件里另外两处 `https://chart-ix.vercel.app` 改成 `https://chart-ix.com` —— 047 已经因为同样的理由把 pg_net 的地址切过去了（站点绑定自定义域之后 `*.vercel.app` 会 301，是否跟随重定向不在我们控制之内）。

- [ ] **Step 3: 提交**

```bash
git add supabase/migrations/048_screener_alerts.sql .github/workflows/cron-tick.yml
git commit -m "feat(screener): 警报表与 5 分钟扫描 tick

警报必须持久化：首次突破这个语义要求服务端记得上一轮状态，浏览器内的
会话状态一刷新就没了，等于每个用户看到的触发时刻都不一样。

below_count 这一列是为应用层的迟滞准备的（触发 80 / 关闭 75 / 连续 3 次）。
没有迟滞的话，一个在 80 分线上抖动的币会在几十分钟内反复开关警报、
反复推送 Telegram。

部分索引只覆盖未平警报——已关闭的会一直累积，让它们进索引纯属浪费。
刻意不建 insert/update 策略：service role 绕过 RLS，多写一条
「仅 service role」的策略是冗余，反而暗示普通角色某些条件下能写。

GitHub Actions 里剩下的两个 *.vercel.app 一并切到 chart-ix.com，
理由与 047 相同：绑定自定义域后 vercel.app 会 301，是否跟随不在我们控制内。

需要在 Supabase 控制台手动执行这个迁移（与 047 同样的流程）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 警报状态机

**Files:**
- Create: `src/lib/screener/alerts.ts`
- Test: `src/lib/screener/alerts.test.ts`

**Interfaces:**
- Consumes: `ScannerRow`、`Direction`、`ALERT_TRIGGER_SCORE`、`ALERT_CLOSE_SCORE`、`ALERT_CLOSE_STREAK`
- Produces:
  - `OpenAlert = { id: string; symbol: string; direction: Direction; triggerPrice: number; peakPct: number | null; belowCount: number }`
  - `AlertPlan = { opens: NewAlert[]; updates: AlertUpdate[]; closes: string[] }`
  - `NewAlert = { symbol: string; direction: Direction; triggerPrice: number; triggerScore: number; factors: FactorBreakdown }`
  - `AlertUpdate = { id: string; lastPrice: number; peakPct: number; belowCount: number }`
  - `planAlerts(rows: ScannerRow[], open: OpenAlert[]): AlertPlan`
  - `signedPct(triggerPrice: number, lastPrice: number, direction: Direction): number`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/alerts.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { planAlerts, signedPct, type OpenAlert } from "./alerts";
import { ALERT_CLOSE_STREAK } from "./types";
import type { ScannerRow } from "./types";

function row(overrides: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
    price: 100,
    change24h: 1,
    amplitude: 4,
    volumeUsd: 20_000_000,
    marketCap: 300_000_000,
    marketCapRank: 120,
    fundingRate: 0.0001,
    sourceExchange: "Binance",
    ...overrides,
  };
}

function open(overrides: Partial<OpenAlert> = {}): OpenAlert {
  return {
    id: "a1",
    symbol: "TIA-USDT",
    direction: "long",
    triggerPrice: 100,
    peakPct: 0,
    belowCount: 0,
    ...overrides,
  };
}

describe("signedPct", () => {
  it("做多上涨是正收益", () => {
    expect(signedPct(100, 110, "long")).toBeCloseTo(10);
  });

  it("做空下跌是正收益——方向要取符号，否则警报卡会把赚钱显示成亏钱", () => {
    expect(signedPct(100, 90, "short")).toBeCloseTo(10);
  });

  it("做空上涨是负收益", () => {
    expect(signedPct(100, 110, "short")).toBeCloseTo(-10);
  });
});

describe("planAlerts", () => {
  it("总分首次达到触发线时开一条新警报", () => {
    const plan = planAlerts([row({ total: 80 })], []);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].triggerPrice).toBe(100);
    expect(plan.opens[0].triggerScore).toBe(80);
  });

  it("未达触发线不开警报", () => {
    expect(planAlerts([row({ total: 79 })], []).opens).toHaveLength(0);
  });

  it("已有未平警报时不重复开——这是「首次突破」的全部含义", () => {
    const plan = planAlerts([row({ total: 92 })], [open()]);
    expect(plan.opens).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
  });

  it("同方向更新时刷新实时价并把 belowCount 归零", () => {
    const plan = planAlerts([row({ total: 90, price: 110 })], [open({ belowCount: 2 })]);
    expect(plan.updates[0].lastPrice).toBe(110);
    expect(plan.updates[0].belowCount).toBe(0);
  });

  it("peakPct 只涨不跌——它记的是触发以来的最好成绩", () => {
    const plan = planAlerts([row({ price: 105 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBe(20);
  });

  it("刷新更高的 peakPct", () => {
    const plan = planAlerts([row({ price: 130 })], [open({ peakPct: 20 })]);
    expect(plan.updates[0].peakPct).toBeCloseTo(30);
  });

  it("分数落在触发线与关闭线之间时保持未平且不累计——这就是迟滞区间", () => {
    const plan = planAlerts([row({ total: 77 })], [open({ belowCount: 2 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates[0].belowCount).toBe(0);
  });

  it("低于关闭线一次只累计，不关闭", () => {
    const plan = planAlerts([row({ total: 70 })], [open({ belowCount: 0 })]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates[0].belowCount).toBe(1);
  });

  it("连续低于关闭线达到迟滞次数才关闭", () => {
    const plan = planAlerts([row({ total: 70 })], [open({ belowCount: ALERT_CLOSE_STREAK - 1 })]);
    expect(plan.closes).toEqual(["a1"]);
  });

  it("在 80 线上抖动不会反复开关警报", () => {
    let state = [open({ belowCount: 0 })];
    // 79 → 81 → 78 → 82，四轮下来既没关闭也没新开
    for (const total of [79, 81, 78, 82]) {
      const plan = planAlerts([row({ total })], state);
      expect(plan.closes).toHaveLength(0);
      expect(plan.opens).toHaveLength(0);
      state = [open({ belowCount: plan.updates[0].belowCount })];
    }
  });

  it("方向翻转时关掉旧的、开一条新的", () => {
    const plan = planAlerts([row({ direction: "short", total: 88 })], [open({ direction: "long" })]);
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(1);
    expect(plan.opens[0].direction).toBe("short");
  });

  it("方向翻转但新方向没达到触发线时只关不开", () => {
    const plan = planAlerts([row({ direction: "short", total: 60 })], [open({ direction: "long" })]);
    expect(plan.closes).toEqual(["a1"]);
    expect(plan.opens).toHaveLength(0);
  });

  it("这一轮扫描里整个消失的币，警报保持原样不动", () => {
    // 币掉出候选池（成交量萎缩等）不等于信号失效，更不等于价格数据可信。
    // 强行按「缺席」关闭会在池子边缘反复误关。
    const plan = planAlerts([], [open()]);
    expect(plan.closes).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.opens).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/alerts.test.ts`
Expected: FAIL，`Failed to resolve import "./alerts"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/alerts.ts`：

```ts
import type { Direction, FactorBreakdown, ScannerRow } from "./types";
import { ALERT_TRIGGER_SCORE, ALERT_CLOSE_SCORE, ALERT_CLOSE_STREAK } from "./types";

export interface OpenAlert {
  id: string;
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  peakPct: number | null;
  belowCount: number;
}

export interface NewAlert {
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  triggerScore: number;
  factors: FactorBreakdown;
}

export interface AlertUpdate {
  id: string;
  lastPrice: number;
  peakPct: number;
  belowCount: number;
}

export interface AlertPlan {
  opens: NewAlert[];
  updates: AlertUpdate[];
  /** 要关闭的警报 id */
  closes: string[];
}

/**
 * 触发以来的顺方向涨跌幅。做空下跌算正收益 —— 不取符号的话
 * 警报卡会把一笔赚钱的空单显示成亏钱。
 */
export function signedPct(triggerPrice: number, lastPrice: number, direction: Direction): number {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return 0;
  const raw = ((lastPrice - triggerPrice) / triggerPrice) * 100;
  return direction === "long" ? raw : -raw;
}

/**
 * 纯函数：给定本轮扫描结果与当前未平警报，算出要开/更新/关闭哪些。
 * 不碰 DB —— 调用方负责把这份计划落库，这样状态机本身可以完全离线测试。
 *
 * 三条容易写错的规则：
 *
 * 1. **迟滞。** 触发线 80、关闭线 75，中间这 5 分是缓冲区：分数落在
 *    [75, 80) 时警报既不关闭也不累计 belowCount。没有这段缓冲，一个在
 *    80 线上抖动的币会在几十分钟内反复开关、反复推送 Telegram。
 *
 * 2. **缺席 ≠ 失效。** 币这一轮掉出候选池（成交量萎缩、市值漂移出区间）
 *    时不做任何处理，警报原样保留。按「缺席」关闭会让池子边缘的币
 *    反复误关，而且那一刻我们连它的价格都没有，关闭时刻的记录会是错的。
 *
 * 3. **锁定价永不改写。** 只更新 lastPrice / peakPct / belowCount，
 *    triggerPrice 是这条警报存在的意义，改了整条记录就没用了。
 */
export function planAlerts(rows: ScannerRow[], open: OpenAlert[]): AlertPlan {
  const plan: AlertPlan = { opens: [], updates: [], closes: [] };
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const openBySymbol = new Map(open.map((a) => [a.symbol, a]));

  for (const alert of open) {
    const row = bySymbol.get(alert.symbol);
    if (!row) continue; // 规则 2

    if (row.direction !== alert.direction) {
      plan.closes.push(alert.id);
      continue; // 新方向要不要开警报，交给下面的新开循环统一判断
    }

    const nextBelow = row.total < ALERT_CLOSE_SCORE ? alert.belowCount + 1 : 0;
    if (nextBelow >= ALERT_CLOSE_STREAK) {
      plan.closes.push(alert.id);
      continue;
    }

    plan.updates.push({
      id: alert.id,
      lastPrice: row.price,
      // peakPct 只涨不跌：它记的是「触发以来最好到过哪儿」，不是当前浮盈
      peakPct: Math.max(alert.peakPct ?? 0, signedPct(alert.triggerPrice, row.price, row.direction)),
      belowCount: nextBelow,
    });
  }

  for (const row of rows) {
    if (row.total < ALERT_TRIGGER_SCORE) continue;
    const existing = openBySymbol.get(row.symbol);
    // 同方向已有未平警报 → 这不是「首次突破」，跳过。
    // 反方向的那条已经在上面被关掉了，这里正好开新的。
    if (existing && existing.direction === row.direction) continue;

    plan.opens.push({
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: row.price,
      triggerScore: row.total,
      factors: row.factors,
    });
  }

  return plan;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/alerts.test.ts`
Expected: PASS，16 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/alerts.ts src/lib/screener/alerts.test.ts
git commit -m "feat(screener): 警报状态机

写成不碰 DB 的纯函数：给定本轮扫描结果与当前未平警报，算出要开/更新/
关闭哪些，调用方负责落库。这样状态机可以完全离线测试。

三条容易写错的规则都有对应用例：
· 迟滞——分数落在 [75,80) 时既不关闭也不累计。没有这段缓冲，一个在
  80 线上抖动的币会在几十分钟内反复开关、反复推送。
· 缺席不等于失效——币掉出候选池时不做任何处理。按缺席关闭会让池子
  边缘的币反复误关，而且那一刻连它的价格都没有，关闭记录会是错的。
· peakPct 只涨不跌，triggerPrice 永不改写。

signedPct 按方向取符号，否则警报卡会把一笔赚钱的空单显示成亏钱。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: 缓存层与两个路由

**Files:**
- Create: `src/lib/screener/cache.ts`
- Create: `src/lib/screener/alerts-store.ts`
- Create: `src/app/api/cron/screener-scan/route.ts`
- Modify: `src/app/api/screener/route.ts`

**Interfaces:**
- Consumes: `runScan`（Task 9）、`planAlerts`/`OpenAlert`（Task 11）、`createTtlCache`（`@/lib/ttl-cache`）、`createServiceRoleClient`（`@/lib/supabase/middleware`）、`authorizeCronTick`（`@/lib/cron-auth`）
- Produces:
  - `getScannerPayload(): Promise<ScannerPayload>`
  - `readScannerCache(): Promise<ScannerPayload | null>`、`writeScannerCache(p: ScannerPayload): Promise<void>`
  - `listOpenAlerts(): Promise<OpenAlert[]>`、`applyAlertPlan(plan: AlertPlan): Promise<NewAlert[]>` —— 返回真正新建成功的那些，供推送使用
  - `AlertRecord`（前端用的形状）与 `listAlertRecords(): Promise<AlertRecord[]>`

- [ ] **Step 1: 写实现（这一任务没有单元测试，理由见下）**

这一任务全是网络与 DB 编排，单元测试只能测到 mock 的行为。真实验证放在 Task 18 的 dryrun 脚本与手动冒烟里。

创建 `src/lib/screener/cache.ts`：

```ts
import { createTtlCache } from "@/lib/ttl-cache";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { runScan } from "./pipeline";
import { SCAN_INTERVAL_MS } from "./types";
import type { ScannerPayload } from "./types";

/**
 * DB 侧的跨实例缓存。查不到、已过期、或 DB 打不通一律返回 null 交给调用方，
 * 这一层的失败绝不能变成整个选币接口失败。
 */
export async function readScannerCache(): Promise<ScannerPayload | null> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("screener_cache")
      .select("payload, computed_at")
      .eq("id", 1)
      .maybeSingle();

    if (!data) return null;
    const age = Date.now() - new Date(data.computed_at).getTime();
    if (age < 0 || age >= SCAN_INTERVAL_MS) return null;
    return data.payload as ScannerPayload;
  } catch {
    return null;
  }
}

/** 写入失败只记录、不抛出——一次算好的结果不能因为存不进 DB 就白算。 */
export async function writeScannerCache(payload: ScannerPayload): Promise<void> {
  try {
    const client = createServiceRoleClient();
    await client.from("screener_cache").upsert({
      id: 1,
      payload,
      computed_at: new Date(payload.computedAt).toISOString(),
    });
  } catch (err) {
    console.error("[screener] failed to persist DB cache", err);
  }
}

/** 距上次成功扫描是否已满 SCAN_INTERVAL_MS。cron 路由用它做门控。 */
export async function isScanDue(): Promise<boolean> {
  return (await readScannerCache()) === null;
}

async function computeWithDbCache(): Promise<ScannerPayload> {
  const cached = await readScannerCache();
  if (cached) return cached;
  const payload = await runScan();
  await writeScannerCache(payload);
  return payload;
}

// 全站共用一份结果：TTL 到期前所有请求读同一份，冷缓存时并发请求
// 只触发一次上游计算。compute 内部还有一层 DB 缓存，兜住
// 「这个实例是冷的，但别的实例不是」。
const scannerCache = createTtlCache<ScannerPayload>({
  ttlMs: SCAN_INTERVAL_MS,
  compute: computeWithDbCache,
});

export function getScannerPayload(): Promise<ScannerPayload> {
  return scannerCache.get();
}
```

创建 `src/lib/screener/alerts-store.ts`：

```ts
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { AlertPlan, NewAlert, OpenAlert } from "./alerts";
import { signedPct } from "./alerts";
import type { Direction, FactorBreakdown } from "./types";

/** 前端警报栏需要的一行 */
export interface AlertRecord {
  id: string;
  symbol: string;
  direction: Direction;
  triggeredAt: string;
  triggerPrice: number;
  triggerScore: number;
  factors: FactorBreakdown;
  lastPrice: number | null;
  peakPct: number | null;
  /** 触发价 → 实时价的顺方向涨跌幅，服务端算好省得前端各算各的 */
  currentPct: number | null;
}

interface AlertRow {
  id: string;
  symbol: string;
  direction: Direction;
  triggered_at: string;
  trigger_price: number | string;
  trigger_score: number;
  factors: FactorBreakdown;
  last_price: number | string | null;
  peak_pct: number | string | null;
  below_count: number;
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function listOpenAlerts(): Promise<OpenAlert[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("screener_alerts")
    .select("id, symbol, direction, trigger_price, peak_pct, below_count")
    .is("closed_at", null);

  if (error) throw new Error(`Failed to load open alerts: ${error.message}`);

  return (data ?? []).map((r) => {
    const row = r as Pick<AlertRow, "id" | "symbol" | "direction" | "trigger_price" | "peak_pct" | "below_count">;
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      triggerPrice: num(row.trigger_price) ?? 0,
      peakPct: num(row.peak_pct),
      belowCount: row.below_count,
    };
  });
}

/**
 * 落库顺序刻意是「先关、再更新、最后开」。
 *
 * 方向翻转会在同一个计划里同时产生一条 close 和一条 open，两者是同一个
 * symbol。先开后关的话，那一瞬间同一个币有两条未平警报，而下一轮的
 * listOpenAlerts 会两条都读回来 —— 状态机的 openBySymbol 是个 Map，
 * 后写的会覆盖前一条，另一条从此永远关不掉。
 *
 * 返回真正新建成功的那些，供调用方推送。新建失败（比如 DB 抖动）时
 * 绝不能推送——推了却没落库，下一轮会当成「还没触发过」再推一次。
 */
export async function applyAlertPlan(plan: AlertPlan): Promise<NewAlert[]> {
  const client = createServiceRoleClient();

  if (plan.closes.length > 0) {
    const { error } = await client
      .from("screener_alerts")
      .update({ closed_at: new Date().toISOString() })
      .in("id", plan.closes);
    if (error) console.error("[screener] failed to close alerts", error);
  }

  for (const u of plan.updates) {
    const { error } = await client
      .from("screener_alerts")
      .update({
        last_price: u.lastPrice,
        last_price_at: new Date().toISOString(),
        peak_pct: u.peakPct,
        below_count: u.belowCount,
      })
      .eq("id", u.id);
    if (error) console.error("[screener] failed to update alert", u.id, error);
  }

  if (plan.opens.length === 0) return [];

  const { data, error } = await client
    .from("screener_alerts")
    .insert(
      plan.opens.map((o) => ({
        symbol: o.symbol,
        direction: o.direction,
        trigger_price: o.triggerPrice,
        trigger_score: o.triggerScore,
        factors: o.factors,
        last_price: o.triggerPrice,
        last_price_at: new Date().toISOString(),
        peak_pct: 0,
      }))
    )
    .select("symbol");

  if (error) {
    console.error("[screener] failed to open alerts", error);
    return [];
  }

  const inserted = new Set((data ?? []).map((r) => (r as { symbol: string }).symbol));
  return plan.opens.filter((o) => inserted.has(o.symbol));
}

/** 供前端警报栏读取的未平警报，按触发时间倒序。 */
export async function listAlertRecords(): Promise<AlertRecord[]> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("screener_alerts")
    .select("id, symbol, direction, triggered_at, trigger_price, trigger_score, factors, last_price, peak_pct, below_count")
    .is("closed_at", null)
    .order("triggered_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[screener] failed to list alerts", error);
    return [];
  }

  return (data ?? []).map((r) => {
    const row = r as AlertRow;
    const triggerPrice = num(row.trigger_price) ?? 0;
    const lastPrice = num(row.last_price);
    return {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction,
      triggeredAt: row.triggered_at,
      triggerPrice,
      triggerScore: row.trigger_score,
      factors: row.factors,
      lastPrice,
      peakPct: num(row.peak_pct),
      currentPct: lastPrice === null ? null : signedPct(triggerPrice, lastPrice, row.direction),
    };
  });
}

/** 标记这批警报已推送。失败只记录——推都推了，标记不上不该让整轮扫描失败。 */
export async function markAlertsPushed(symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  try {
    const client = createServiceRoleClient();
    await client
      .from("screener_alerts")
      .update({ pushed_at: new Date().toISOString() })
      .is("closed_at", null)
      .is("pushed_at", null)
      .in("symbol", symbols);
  } catch (err) {
    console.error("[screener] failed to mark alerts pushed", err);
  }
}
```

创建 `src/app/api/cron/screener-scan/route.ts`：

```ts
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronTick } from "@/lib/cron-auth";
import { runScan } from "@/lib/screener/pipeline";
import { isScanDue, writeScannerCache } from "@/lib/screener/cache";
import { planAlerts } from "@/lib/screener/alerts";
import { listOpenAlerts, applyAlertPlan } from "@/lib/screener/alerts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 一轮完整扫描实测约 22 秒。60 是 Vercel Hobby 的上限，不能再高。
export const maxDuration = 60;

const JOB_NAME = "screener-scan";

export async function GET(request: NextRequest) {
  const auth = await authorizeCronTick(request.headers.get("authorization"), JOB_NAME);
  if (!auth.ok) {
    return NextResponse.json({ error: "Too many ticks", retryAfterMs: auth.retryAfterMs }, { status: auth.status });
  }

  // 提前退出不是优化，是必需：触发器每 5 分钟打一次而扫描间隔是 15 分钟，
  // 三次里有两次应该在这里就走人，只花一次单行 DB 读。
  if (!(await isScanDue())) {
    return NextResponse.json({ skipped: true, reason: "not due" });
  }

  try {
    const payload = await runScan();
    await writeScannerCache(payload);

    const open = await listOpenAlerts();
    const plan = planAlerts(payload.rows, open);
    const opened = await applyAlertPlan(plan);

    return NextResponse.json({
      rows: payload.rows.length,
      opened: opened.length,
      updated: plan.updates.length,
      closed: plan.closes.length,
    });
  } catch (error) {
    console.error("[cron/screener-scan]", error);
    // 500 让调度器把这次 run 记成失败（可见性），下一个 tick 会自愈重试。
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
```

改 `src/app/api/screener/route.ts`，整个文件替换成：

```ts
import { NextResponse } from "next/server";
import { getScannerPayload } from "@/lib/screener/cache";
import { listAlertRecords } from "@/lib/screener/alerts-store";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 警报读失败不该拖垮榜单——listAlertRecords 内部已经吞掉错误返回 []，
    // 这里用 allSettled 再兜一层，防止将来有人改成抛错。
    const [payloadSettled, alertsSettled] = await Promise.allSettled([
      getScannerPayload(),
      listAlertRecords(),
    ]);

    if (payloadSettled.status === "rejected") throw payloadSettled.reason;

    return NextResponse.json(
      {
        success: true,
        data: {
          ...payloadSettled.value,
          alerts: alertsSettled.status === "fulfilled" ? alertsSettled.value : [],
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=900" } }
    );
  } catch (error) {
    console.error("[screener]", error);
    return NextResponse.json(
      { success: false, error: { code: "SCREENER_UNAVAILABLE", message: "Screener data unavailable" } },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 新文件零错误。此时 `telegram-push.ts` 仍指向旧模块，那些错误留到 Task 13 处理。

- [ ] **Step 3: 跑全部测试确认没有回归**

Run: `npm test`
Expected: 除既有的 `screener-scoring.test.ts` 外全部通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/screener/cache.ts src/lib/screener/alerts-store.ts src/app/api/cron/screener-scan/route.ts src/app/api/screener/route.ts
git commit -m "feat(screener): 缓存层、警报落库与扫描路由

落库顺序刻意是先关、再更新、最后开。方向翻转会在同一个计划里对同一个
symbol 同时产生 close 和 open；先开后关的话那一瞬间会有两条未平警报，
下一轮 listOpenAlerts 两条都读回来、状态机的 Map 后写覆盖前写，
另一条从此永远关不掉。

applyAlertPlan 只返回真正插入成功的那些。新建失败时绝不能推送——
推了却没落库，下一轮会当成还没触发过再推一次。

cron 路由的提前退出不是优化：触发器 5 分钟一打而扫描间隔 15 分钟，
三次里有两次应该只花一次单行 DB 读就走人。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Telegram 榜单推送迁移到单表形状

**Files:**
- Modify: `src/lib/telegram-push.ts`
- Modify: `src/app/api/cron/telegram-push/route.ts`
- Modify: `src/app/admin/telegram-push/TelegramPushEditor.tsx`
- Modify: `src/i18n/messages/{zh-CN,en-US,ms-MY}.json`
- Test: `src/lib/telegram-push-format.test.ts`

**Interfaces:**
- Consumes: `ScannerRow`、`ScannerPayload`（Task 3）；`getScannerPayload`（Task 12）
- Produces: `formatScannerMessage(payload: ScannerPayload, settings: TelegramPushSettings, lang: TelegramMessageLang): string`
- 改名：`TelegramPushSettings.showOiRatio` → `showDirection`，`showEdge` → `showFactors`（**DB 列名 `show_oi_ratio` / `show_edge` 不变**，见下）

**这个任务必须做，不是可选的：** `telegram-push.ts` 直接 import 了 `getScreenerPayload` 与 `ScreenerResult`。旧模块删掉之后不迁移它，整个项目编译不过。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/telegram-push-format.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { formatScannerMessage } from "./telegram-push";
import type { TelegramPushSettings } from "./telegram-push";
import type { ScannerPayload, ScannerRow } from "./screener/types";

const settings: TelegramPushSettings = {
  enabled: true,
  botToken: null,
  chatId: null,
  messageLang: "zh",
  pushIntervalMinutes: 60,
  showPrice: true,
  showChange24h: true,
  showAmplitude: true,
  showMarketCap: true,
  showVolume: true,
  showDirection: true,
  showFunding: true,
  showScore: true,
  showFactors: true,
  lastPushedAt: null,
  lastAttemptAt: null,
  lastError: null,
  consecutiveFailures: 0,
  updatedAt: "",
};

function row(o: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
    price: 0.296,
    change24h: -1.92,
    amplitude: 4.3,
    volumeUsd: 21_400_000,
    marketCap: 311_000_000,
    marketCapRank: 120,
    fundingRate: 0.005,
    sourceExchange: "Binance",
    ...o,
  };
}

const payload: ScannerPayload = { rows: [row()], computedAt: Date.UTC(2026, 7, 18, 12, 0) };

describe("formatScannerMessage", () => {
  it("是一张按总分排序的单表，不再分做多/做空两组", () => {
    const msg = formatScannerMessage(payload, settings, "zh");
    expect(msg).not.toContain("做多优势");
    expect(msg).not.toContain("做空优势");
    expect(msg).toContain("TIA");
  });

  it("带上方向标记", () => {
    expect(formatScannerMessage(payload, settings, "zh")).toContain("做多");
  });

  it("因子构成按 Zone/Sweep/OI/CVD 顺序展开", () => {
    const msg = formatScannerMessage(payload, settings, "en");
    expect(msg).toMatch(/Z28.*S18.*OI25.*CVD14/);
  });

  it("关掉因子开关就不输出因子构成", () => {
    const msg = formatScannerMessage(payload, { ...settings, showFactors: false }, "en");
    expect(msg).not.toContain("CVD14");
  });

  it("资金费率为 null 时整段省略，而不是显示 0.0000%", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ fundingRate: null })] };
    expect(formatScannerMessage(p, settings, "en")).not.toContain("Funding");
  });

  it("空榜单给一句明确的话，不给一张空表", () => {
    const msg = formatScannerMessage({ rows: [], computedAt: 0 }, settings, "zh");
    expect(msg).toContain("暂无");
  });

  it("最多只列前 15 行——Telegram 单条消息有长度上限", () => {
    const many: ScannerPayload = {
      rows: Array.from({ length: 40 }, (_, i) => row({ symbol: `C${i}-USDT`, coin: `C${i}` })),
      computedAt: 0,
    };
    const msg = formatScannerMessage(many, settings, "en");
    expect(msg).toContain("C14");
    expect(msg).not.toContain("C15");
  });

  it("转义 HTML，防止币名里的尖括号破坏 parse_mode", () => {
    const p: ScannerPayload = { ...payload, rows: [row({ symbol: "<b>-USDT", coin: "<b>" })] };
    expect(formatScannerMessage(p, settings, "en")).toContain("&lt;b&gt;");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/telegram-push-format.test.ts`
Expected: FAIL（`formatScannerMessage` 不存在）

- [ ] **Step 3: 改实现**

在 `src/lib/telegram-push.ts` 里：

1. 把第 3 行 `import { getScreenerPayload, type ScreenerPayload } from "@/lib/screener-server";` 换成
   `import { getScannerPayload } from "@/lib/screener/cache";`
2. 把第 9 行 `import type { ScreenerResult, Direction } from "@/lib/screener-scoring";` 换成
   `import type { ScannerRow, ScannerPayload } from "@/lib/screener/types";`
3. `TelegramPushSettings` 里 `showOiRatio: boolean;` 改名为 `showDirection: boolean;`，
   `showEdge: boolean;` 改名为 `showFactors: boolean;`，并在两处加注释：

```ts
  /**
   * 方向标记。DB 列仍叫 show_oi_ratio —— 四因子模型里没有 OI/量比这个字段了，
   * 但这一列的语义（"表格里多显示一栏"）可以原样承接，为一个纯展示开关
   * 加一次迁移不值得。改名只发生在 TS 这一侧，读写映射见 getTelegramPushSettings。
   */
  showDirection: boolean;
  /**
   * 四因子构成。DB 列仍叫 show_edge，理由同上——edge 这个概念随
   * 6 维模型一起退役了，这一列改承接"显示 Zone/Sweep/OI/CVD 明细"。
   */
  showFactors: boolean;
```

4. 在 `getTelegramPushSettings` 里把读取处改成 `showDirection: row.show_oi_ratio ?? true,` 与 `showFactors: row.show_edge ?? true,`；在 `updateTelegramPushSettings` 里把写入处改成 `if (input.showDirection !== undefined) patch.show_oi_ratio = input.showDirection;` 与 `if (input.showFactors !== undefined) patch.show_edge = input.showFactors;`（`TelegramPushUpdate` 的字段名同步改）。
5. `MESSAGE_STRINGS` 里删掉 `long` / `short` / `oiRatio` / `edge`，新增 `factors` 与 `empty`，并把 `title` 改掉：

```ts
const MESSAGE_STRINGS: Record<
  TelegramMessageLang,
  {
    title: string;
    empty: string;
    long: string;
    short: string;
    price: string;
    change24h: string;
    amplitude: string;
    marketCap: string;
    volume: string;
    funding: string;
    score: string;
  }
> = {
  en: {
    title: "Chart-IX Scanner",
    empty: "(no candidates right now)",
    long: "LONG",
    short: "SHORT",
    price: "Price",
    change24h: "24h",
    amplitude: "Amp",
    marketCap: "MCap",
    volume: "Vol",
    funding: "Funding",
    score: "Score",
  },
  zh: {
    title: "Chart-IX 扫描器",
    empty: "（当前暂无符合条件的品种）",
    long: "做多",
    short: "做空",
    price: "价格",
    change24h: "24h",
    amplitude: "振幅",
    marketCap: "市值",
    volume: "成交量",
    funding: "费率",
    score: "总分",
  },
};
```

6. 删掉 `formatRow`、`formatGroup`、`formatScreenerMessage` 三个函数，换成：

```ts
/**
 * Telegram 单条消息有 4096 字符上限，一条 15 行的表离上限还有余量。
 * 榜单已按总分降序排好，截断只会丢掉分数最低的那些。
 */
const MAX_PUSH_ROWS = 15;

function formatScannerRow(
  r: ScannerRow,
  settings: TelegramPushSettings,
  lang: TelegramMessageLang
): string {
  const s = MESSAGE_STRINGS[lang];
  const symbol = escapeHtml(r.coin);
  const parts: string[] = [];

  if (settings.showDirection) parts.push(r.direction === "long" ? s.long : s.short);
  if (settings.showScore) parts.push(`${s.score} ${r.total}`);
  if (settings.showFactors) {
    parts.push(`Z${r.factors.zone}/S${r.factors.sweep}/OI${r.factors.oi}/CVD${r.factors.cvd}`);
  }
  if (settings.showPrice) parts.push(`${s.price} ${fmtPrice(r.price)}`);
  if (settings.showChange24h && r.change24h !== null) {
    parts.push(`${s.change24h} ${fmtPercent(r.change24h)}`);
  }
  if (settings.showAmplitude) parts.push(`${s.amplitude} ${r.amplitude.toFixed(1)}%`);
  if (settings.showMarketCap) parts.push(`${s.marketCap} $${(r.marketCap / 1_000_000).toFixed(1)}M`);
  if (settings.showVolume) parts.push(`${s.volume} $${(r.volumeUsd / 1_000_000).toFixed(1)}M`);
  // null 与 0 必须区分开：0 是一个完全真实的资金费率，
  // 拿它显示"没数据"会让人以为这个币此刻不收费率。
  if (settings.showFunding && r.fundingRate !== null) {
    parts.push(`${s.funding} ${fmtPercent(r.fundingRate * 100)}`);
  }

  return parts.length > 0 ? `<b>${symbol}</b> — ${parts.join(" · ")}` : `<b>${symbol}</b>`;
}

/**
 * 单表按总分降序，不再分做多/做空两组。
 * 四因子模型里每个币只有一个方向判定（象限本身就定方向），
 * 双榜在这个模型下会把同一批币按同一个分数印两遍。
 */
export function formatScannerMessage(
  payload: ScannerPayload,
  settings: TelegramPushSettings,
  lang: TelegramMessageLang = settings.messageLang
): string {
  const s = MESSAGE_STRINGS[lang];
  const timestamp = new Date(payload.computedAt).toISOString().replace("T", " ").slice(0, 16);
  const head = `📊 <b>${s.title}</b> · ${timestamp} UTC`;

  if (payload.rows.length === 0) return `${head}\n\n${s.empty}`;

  const lines = payload.rows
    .slice(0, MAX_PUSH_ROWS)
    .map((r, i) => `${i + 1}. ${formatScannerRow(r, settings, lang)}`);

  return `${head}\n\n${lines.join("\n")}`;
}
```

7. `pushScreenerToTelegram` 的入参类型 `ScreenerPayload` 改成 `ScannerPayload`，函数体里 `formatScreenerMessage(payload, settings, lang)` 改成 `formatScannerMessage(payload, settings, lang)`。
8. `pushScreenerNow` 里 `const payload = await getScreenerPayload();` 改成 `const payload = await getScannerPayload();`。

改 `src/app/api/cron/telegram-push/route.ts`：把 `import { getScreenerPayload } from "@/lib/screener-server";` 换成 `import { getScannerPayload } from "@/lib/screener/cache";`，并把调用处的 `getScreenerPayload()` 改成 `getScannerPayload()`。

改 `src/app/admin/telegram-push/TelegramPushEditor.tsx`：
- 第 24 行 `showOiRatio: boolean;` → `showDirection: boolean;`
- 第 27 行 `showEdge: boolean;` → `showFactors: boolean;`
- 第 65 行 `{ key: "showOiRatio", labelKey: "field_oi_ratio" },` → `{ key: "showDirection", labelKey: "field_direction" },`
- 第 68 行 `{ key: "showEdge", labelKey: "field_edge" },` → `{ key: "showFactors", labelKey: "field_factors" },`

在三个 i18n 文件里，找到 `field_oi_ratio` 与 `field_edge` 所在的对象，把这两个键改名并改文案：

zh-CN：`"field_direction": "方向"`、`"field_factors": "因子构成"`
en-US：`"field_direction": "Direction"`、`"field_factors": "Factors"`
ms-MY：`"field_direction": "Arah"`、`"field_factors": "Faktor"`

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/telegram-push-format.test.ts`
Expected: PASS，8 个用例全绿

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 只剩 `src/hooks/useScreenerData.ts`、`src/components/screener/ScreenerTable.tsx`、`src/app/[locale]/(app)/screener/page.tsx` 三处仍指向旧模块的错误，它们在 Task 15–17 处理

- [ ] **Step 6: 提交**

```bash
git add src/lib/telegram-push.ts src/lib/telegram-push-format.test.ts src/app/api/cron/telegram-push/route.ts src/app/admin/telegram-push/TelegramPushEditor.tsx src/i18n/messages/
git commit -m "refactor(telegram): 榜单推送迁移到四因子单表

telegram-push 直接依赖 getScreenerPayload 与 ScreenerResult，旧模块
删掉之后不迁移它整个项目编译不过——这是必须做的一步，不是可选的。

单表按总分降序，不再分做多/做空两组：四因子模型里每个币只有一个
方向判定（象限本身就定方向），双榜会把同一批币按同一个分数印两遍。

showOiRatio / showEdge 改名成 showDirection / showFactors，但 DB 列名
保持 show_oi_ratio / show_edge 不变——为两个纯展示开关加一次迁移
不值得，改名只发生在 TS 这一侧。

资金费率 null 与 0 必须区分：0 是完全真实的费率，拿它显示"没数据"
会让人以为这个币此刻不收费率。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: 警报 Telegram 推送

**Files:**
- Create: `src/lib/screener/alert-push.ts`
- Test: `src/lib/screener/alert-push.test.ts`
- Modify: `src/app/api/cron/screener-scan/route.ts`
- Modify: `src/i18n/messages/{zh-CN,en-US,ms-MY}.json`

**Interfaces:**
- Consumes: `NewAlert`（Task 11）、`applyAlertPlan` 的返回值、`listTargetsFor`/`deliverToTargets`/`getTelegramPushSettings`/`escapeHtml`（`@/lib/telegram-push`）、`markAlertsPushed`（Task 12）
- Produces:
  - `AlertPushConfig = { enabled: boolean; minScore: number }`
  - `getAlertPushConfig(): Promise<AlertPushConfig>`
  - `formatAlertMessage(alerts: NewAlert[], lang: TelegramMessageLang): string`
  - `pushNewAlerts(alerts: NewAlert[]): Promise<number>` —— 返回实际推送的条数

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/screener/alert-push.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { formatAlertMessage, parseAlertPushConfig } from "./alert-push";
import type { NewAlert } from "./alerts";

const alert: NewAlert = {
  symbol: "TIA-USDT",
  direction: "long",
  triggerPrice: 0.2961,
  triggerScore: 87,
  factors: { zone: 29, sweep: 19, oi: 26, cvd: 13 },
};

describe("parseAlertPushConfig", () => {
  it("解析后台存的 JSON", () => {
    expect(parseAlertPushConfig({ enabled: true, minScore: 85 })).toEqual({ enabled: true, minScore: 85 });
  });

  it("没配置过时默认关闭——新功能不该自己开始往群里发消息", () => {
    expect(parseAlertPushConfig(null)).toEqual({ enabled: false, minScore: 80 });
  });

  it("minScore 低于触发线时抬回触发线，低了也不会有更多警报", () => {
    expect(parseAlertPushConfig({ enabled: true, minScore: 50 }).minScore).toBe(80);
  });

  it("字段类型不对时退回默认值而不是抛错", () => {
    expect(parseAlertPushConfig({ enabled: "yes", minScore: "high" })).toEqual({
      enabled: false,
      minScore: 80,
    });
  });
});

describe("formatAlertMessage", () => {
  it("带上锁定价——这是整条警报的基准，缺了它后续的累计涨跌无从谈起", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("0.2961");
  });

  it("带上触发分与四因子构成", () => {
    const msg = formatAlertMessage([alert], "en");
    expect(msg).toContain("87");
    expect(msg).toMatch(/Z29.*S19.*OI26.*CVD13/);
  });

  it("方向用文字标出", () => {
    expect(formatAlertMessage([alert], "zh")).toContain("做多");
  });

  it("多条警报合并成一条消息，而不是刷屏", () => {
    const msg = formatAlertMessage([alert, { ...alert, symbol: "JTO-USDT" }], "en");
    expect(msg).toContain("TIA");
    expect(msg).toContain("JTO");
    expect(msg.split("\n").filter((l) => l.includes("Z29")).length).toBe(2);
  });

  it("转义 HTML", () => {
    expect(formatAlertMessage([{ ...alert, symbol: "<i>-USDT" }], "en")).toContain("&lt;i&gt;");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/alert-push.test.ts`
Expected: FAIL，`Failed to resolve import "./alert-push"`

- [ ] **Step 3: 写实现**

创建 `src/lib/screener/alert-push.ts`：

```ts
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import {
  getTelegramPushSettings,
  listTargetsFor,
  deliverToTargets,
  escapeHtml,
  type TelegramMessageLang,
} from "@/lib/telegram-push";
import { markAlertsPushed } from "./alerts-store";
import { ALERT_TRIGGER_SCORE } from "./types";
import type { NewAlert } from "./alerts";

const SETTINGS_KEY = "screener_alert_push";

export interface AlertPushConfig {
  enabled: boolean;
  /** 只推总分达到这个数的警报。可以调高到 85 只推最强信号。 */
  minScore: number;
}

/**
 * 默认**关闭**。一个新上线的功能不该自己开始往用户的 Telegram 群里发消息——
 * 15 分钟一扫、整池 150 个币，开着不管一天可以推出几十条。
 * 要开就去后台显式打开。
 */
export function parseAlertPushConfig(value: unknown): AlertPushConfig {
  const fallback: AlertPushConfig = { enabled: false, minScore: ALERT_TRIGGER_SCORE };
  if (!value || typeof value !== "object") return fallback;

  const v = value as Record<string, unknown>;
  const enabled = typeof v.enabled === "boolean" ? v.enabled : false;
  const raw = typeof v.minScore === "number" && Number.isFinite(v.minScore) ? v.minScore : ALERT_TRIGGER_SCORE;

  return {
    enabled,
    // 低于触发线是无意义的设置：低于 80 分的币根本不会产生警报，
    // 把它抬回触发线，免得后台看着像"我已经调到 50 了怎么还是这么少"。
    minScore: Math.max(ALERT_TRIGGER_SCORE, raw),
  };
}

export async function getAlertPushConfig(): Promise<AlertPushConfig> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    return parseAlertPushConfig((data as { value?: unknown } | null)?.value ?? null);
  } catch {
    // 读不到配置一律当成关闭：宁可漏推，也不要因为一次 DB 抖动
    // 就按默认值开始往群里发消息。
    return { enabled: false, minScore: ALERT_TRIGGER_SCORE };
  }
}

const STRINGS: Record<TelegramMessageLang, { title: string; long: string; short: string; at: string }> = {
  en: { title: "🚨 Scanner Alert", long: "LONG", short: "SHORT", at: "locked at" },
  zh: { title: "🚨 扫描器警报", long: "做多", short: "做空", at: "锁定价" },
};

/**
 * 多条警报合并成**一条**消息。一轮扫描同时触发五六个币是常有的事，
 * 一条一发就是刷屏，而 Telegram 对同一个 chat 的连发也有速率限制。
 */
export function formatAlertMessage(alerts: NewAlert[], lang: TelegramMessageLang): string {
  const s = STRINGS[lang];
  const lines = alerts.map((a) => {
    const dir = a.direction === "long" ? s.long : s.short;
    const coin = escapeHtml(a.symbol.replace(/-USDT$/, ""));
    const f = a.factors;
    return (
      `<b>${coin}</b> ${dir} · ${a.triggerScore}/100 · ` +
      `Z${f.zone}/S${f.sweep}/OI${f.oi}/CVD${f.cvd} · ` +
      `${s.at} ${a.triggerPrice}`
    );
  });
  return `${s.title}\n\n${lines.join("\n")}`;
}

/**
 * 推送新触发的警报。返回实际推送的条数。
 *
 * 只接 Telegram，不接 web-push：现有 web-push 的语义是「用户自己设的
 * 某个币的价格提醒」，是用户主动订阅的。把全站扫描器的警报塞进同一个
 * 通道，等于给所有订阅过价格提醒的人推他们从没要求过的东西。
 * 要接的话应该是一个独立的订阅开关，那是另一个功能。
 */
export async function pushNewAlerts(alerts: NewAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  const config = await getAlertPushConfig();
  if (!config.enabled) return 0;

  const worth = alerts.filter((a) => a.triggerScore >= config.minScore);
  if (worth.length === 0) return 0;

  const settings = await getTelegramPushSettings();
  // 总开关关掉时一条都不发。榜单推送（pushScreenerToTelegram）就是这么做的，
  // 警报没有理由绕过它——运营关掉 Telegram 推送的意思是「让机器人静音」，
  // 而不是「只静音榜单、警报继续发」。这两个开关互相独立，关一个不会连带关另一个。
  if (!settings.enabled) return 0;

  const targets = await listTargetsFor("screener");
  if (targets.length === 0) return 0;
  if (!settings.botToken && targets.every((t) => !t.botToken)) return 0;

  const results = await deliverToTargets(
    settings,
    targets,
    (lang) => formatAlertMessage(worth, lang),
    "cron"
  );

  if (!results.some((r) => r.ok)) return 0;

  await markAlertsPushed(worth.map((a) => a.symbol));
  return worth.length;
}
```

改 `src/app/api/cron/screener-scan/route.ts`：加上 import

```ts
import { pushNewAlerts } from "@/lib/screener/alert-push";
```

并把 `const opened = await applyAlertPlan(plan);` 之后改成：

```ts
    const opened = await applyAlertPlan(plan);
    // 推送失败不该让整轮扫描记成失败——榜单已经算好并落库了，
    // 那才是这个路由的主产出。推送是附加动作。
    let pushed = 0;
    try {
      pushed = await pushNewAlerts(opened);
    } catch (err) {
      console.error("[cron/screener-scan] alert push failed", err);
    }

    return NextResponse.json({
      rows: payload.rows.length,
      opened: opened.length,
      pushed,
      updated: plan.updates.length,
      closed: plan.closes.length,
    });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/screener/alert-push.test.ts`
Expected: PASS，10 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener/alert-push.ts src/lib/screener/alert-push.test.ts src/app/api/cron/screener-scan/route.ts
git commit -m "feat(screener): 警报 Telegram 推送

默认关闭。一个新上线的功能不该自己开始往用户的群里发消息——15 分钟
一扫、整池 150 个币，开着不管一天能推几十条。读配置失败也一律当关闭：
宁可漏推，也不要因为一次 DB 抖动就按默认值开始发。

多条警报合并成一条消息：一轮同时触发五六个币是常事，一条一发就是刷屏，
Telegram 对同一个 chat 的连发也有速率限制。

minScore 低于触发线时抬回触发线——低于 80 分的币根本不会产生警报，
不抬的话后台会看着像「我都调到 50 了怎么还是这么少」。

推送失败不让整轮扫描记成失败：榜单已经算好并落库，那才是主产出。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: 前端数据钩子与文案

**Files:**
- Modify: `src/hooks/useScreenerData.ts`
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: `ScannerRow`、`ScannerPayload`、`SCAN_INTERVAL_MS`（`@/lib/screener/types`）、`AlertRecord`（`@/lib/screener/alerts-store`）
- Produces:
  - `ScannerData = { rows: ScannerRow[]; alerts: AlertRecord[]; isLoading: boolean; error: Error | null; isRefreshing: boolean; lastUpdated: number; refetch: () => void }`
  - `useScannerData(): ScannerData`

- [ ] **Step 1: 改钩子**

`src/hooks/useScreenerData.ts` 整个文件替换成：

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import type { ScannerRow, ScannerPayload } from "@/lib/screener/types";
import type { AlertRecord } from "@/lib/screener/alerts-store";

interface ScannerResponse extends ScannerPayload {
  alerts: AlertRecord[];
}

async function fetchScannerPayload(): Promise<ScannerResponse> {
  const res = await fetch("/api/screener");
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

export interface ScannerData {
  rows: ScannerRow[];
  alerts: AlertRecord[];
  isLoading: boolean;
  error: Error | null;
  /** 请求正在飞行中；用来禁用"立即刷新"按钮，避免连点重复请求 */
  isRefreshing: boolean;
  /** 服务端计算这份结果的时间，ms epoch；0 表示还没成功过。
   *  用服务端时间而不是客户端的 dataUpdatedAt，这样倒计时对所有用户一致。 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScannerData(): ScannerData {
  const query = useQuery<ScannerResponse>({
    queryKey: ["scanner"],
    queryFn: fetchScannerPayload,
    // 客户端跟着服务端的扫描节奏走。服务端有 TTL + DB 双层缓存兜底，
    // 早到的请求只会读到同一份结果，不会触发重复计算。
    refetchInterval: SCAN_INTERVAL_MS,
    staleTime: SCAN_INTERVAL_MS / 2,
  });

  return {
    rows: query.data?.rows ?? [],
    alerts: query.data?.alerts ?? [],
    isLoading: query.isPending,
    error: query.error as Error | null,
    isRefreshing: query.isFetching,
    lastUpdated: query.data?.computedAt ?? 0,
    refetch: () => {
      query.refetch();
    },
  };
}
```

- [ ] **Step 2: 换文案**

把三个 i18n 文件里的 `screener` 对象整个替换。

`src/i18n/messages/zh-CN.json`：

```json
  "screener": {
    "title": "扫描器",
    "subtitle": "OI · CVD · SWEEP · ZONE — 4因子扫描",
    "no_results": "当前筛选条件下没有符合的品种，放宽滑块试试",
    "error": "数据加载失败",
    "retry": "重试",
    "refresh_now": "立即刷新",
    "next_scan": "下次扫描",
    "candidate_count": "{count} 个候选标的",
    "filters": {
      "volume": "24h 成交量 ≥",
      "amplitude": "24h 振幅 ≥",
      "market_cap": "市值区间",
      "direction": "方向",
      "dir_all": "全部",
      "dir_long": "Long",
      "dir_short": "Short"
    },
    "columns": {
      "symbol": "Symbol",
      "direction": "方向",
      "total": "总分",
      "factors": "因子构成",
      "volume": "24h量",
      "amplitude": "24h振幅",
      "market_cap": "市值",
      "updated": "更新",
      "actions": "操作"
    },
    "table_title": "主扫描表",
    "table_hint": "按总分排序 · 点击行查看详情",
    "action_long": "做多",
    "action_short": "做空",
    "alerts": {
      "rail_label": "最新警报",
      "empty": "警报在总分从 <80 首次突破 ≥80 分时触发，锁定当时价格并持续追踪累计涨跌幅。",
      "triggered": "触发",
      "trigger_line": "触发：总分 {score}/100 首次突破 80 分 · Zone {zone}/30 · Sweep {sweep}/20 · OI {oi}/30 · CVD {cvd}/20",
      "first_price": "首次警报价",
      "last_price": "实时价格",
      "cumulative": "首次警报后累计变化",
      "peak": "最高到过"
    },
    "source_note": "数据源 CoinGlass · 价格与下单 BingX · K线取自 {exchange}",
    "guide": {
      "title": "这四个因子是什么？",
      "zone": "Zone（30分）— 7 天成交量分布算出的价值区。做多要价格贴在价值区下沿（密集筹码在脚下当支撑），做空反之。价格已冲出价值区之外只给 4 分——那是追高。",
      "sweep": "Sweep（20分）— 爆仓峰值加价格收回。做多要看到多头爆仓放量（下方止损被扫干净）且价格已经收回上方；做空看空头爆仓。没有爆仓证据就是 0 分。",
      "oi": "OI（30分）— 持仓量与价格的四象限。持仓涨且价格涨 = 新多头进场，对做多最有利；持仓涨价格跌 = 新空头进场。持仓下降的两种情况说明这一波没有新资金，两边都只给中低分。",
      "cvd": "CVD（20分）— 主动买卖的累积差额。一半分看方向，一半分看背离：价格跌但主动买在涨 = 有人承接，这是做多最强的信号；价格涨但主动卖在涨 = 拉高出货。",
      "alert": "总分从 80 分以下首次突破 80 分时触发警报，锁定当时价格。分数掉回 75 分以下并连续三轮才关闭——中间这段缓冲是为了避免在 80 分线上反复触发。"
    }
  },
```

`src/i18n/messages/en-US.json`：

```json
  "screener": {
    "title": "Scanner",
    "subtitle": "OI · CVD · SWEEP · ZONE — 4-factor scan",
    "no_results": "Nothing matches the current filters. Try loosening the sliders.",
    "error": "Failed to load data",
    "retry": "Retry",
    "refresh_now": "Refresh now",
    "next_scan": "Next scan",
    "candidate_count": "{count} candidates",
    "filters": {
      "volume": "24h volume ≥",
      "amplitude": "24h amplitude ≥",
      "market_cap": "Market cap",
      "direction": "Direction",
      "dir_all": "All",
      "dir_long": "Long",
      "dir_short": "Short"
    },
    "columns": {
      "symbol": "Symbol",
      "direction": "Side",
      "total": "Score",
      "factors": "Factors",
      "volume": "24h Vol",
      "amplitude": "24h Amp",
      "market_cap": "Mkt Cap",
      "updated": "Updated",
      "actions": "Actions"
    },
    "table_title": "Scan results",
    "table_hint": "Ranked by score · click a row for details",
    "action_long": "Long",
    "action_short": "Short",
    "alerts": {
      "rail_label": "Latest alerts",
      "empty": "An alert fires the first time a score crosses from below 80 to 80 or above. It locks the price at that moment and tracks the cumulative move from there.",
      "triggered": "fired",
      "trigger_line": "Fired: score {score}/100 first crossed 80 · Zone {zone}/30 · Sweep {sweep}/20 · OI {oi}/30 · CVD {cvd}/20",
      "first_price": "Alert price",
      "last_price": "Live price",
      "cumulative": "Cumulative move since alert",
      "peak": "Peak"
    },
    "source_note": "Data from CoinGlass · price and execution on BingX · candles from {exchange}",
    "guide": {
      "title": "What are the four factors?",
      "zone": "Zone (30 pts) — the value area from a 7-day volume profile. A long wants price hugging the lower edge, where the heaviest volume sits underneath as support; a short wants the opposite. Price outside the value area scores only 4 — that is chasing.",
      "sweep": "Sweep (20 pts) — a liquidation spike plus a price recovery. A long wants long liquidations spiking (stops below have been cleared out) and price already back above the wick; a short wants short liquidations. No liquidation evidence means zero.",
      "oi": "OI (30 pts) — open interest against price, as four quadrants. OI up with price up means fresh longs, the best case for a long; OI up with price down means fresh shorts. Both falling-OI quadrants score low for either side — no new money is behind the move.",
      "cvd": "CVD (20 pts) — cumulative taker buy minus sell. Half the points are direction, half are divergence: price falling while CVD rises means someone is absorbing, the strongest long signal; price rising while CVD falls is distribution.",
      "alert": "An alert fires the first time a score crosses from below 80 to 80 or above, locking the price. It closes only after three consecutive scans below 75 — that buffer is what stops it retriggering around the 80 line."
    }
  },
```

`src/i18n/messages/ms-MY.json`：

```json
  "screener": {
    "title": "Pengimbas",
    "subtitle": "OI · CVD · SWEEP · ZONE — imbasan 4 faktor",
    "no_results": "Tiada yang sepadan dengan penapis semasa. Cuba longgarkan penggelongsor.",
    "error": "Gagal memuatkan data",
    "retry": "Cuba lagi",
    "refresh_now": "Muat semula",
    "next_scan": "Imbasan seterusnya",
    "candidate_count": "{count} calon",
    "filters": {
      "volume": "Volum 24j ≥",
      "amplitude": "Amplitud 24j ≥",
      "market_cap": "Permodalan pasaran",
      "direction": "Arah",
      "dir_all": "Semua",
      "dir_long": "Long",
      "dir_short": "Short"
    },
    "columns": {
      "symbol": "Simbol",
      "direction": "Arah",
      "total": "Skor",
      "factors": "Faktor",
      "volume": "Vol 24j",
      "amplitude": "Amp 24j",
      "market_cap": "Permodalan",
      "updated": "Dikemas kini",
      "actions": "Tindakan"
    },
    "table_title": "Keputusan imbasan",
    "table_hint": "Disusun mengikut skor · klik baris untuk butiran",
    "action_long": "Long",
    "action_short": "Short",
    "alerts": {
      "rail_label": "Amaran terkini",
      "empty": "Amaran dicetuskan kali pertama skor melepasi 80. Harga pada ketika itu dikunci dan perubahan terkumpul dijejaki dari situ.",
      "triggered": "dicetuskan",
      "trigger_line": "Dicetuskan: skor {score}/100 melepasi 80 · Zone {zone}/30 · Sweep {sweep}/20 · OI {oi}/30 · CVD {cvd}/20",
      "first_price": "Harga amaran",
      "last_price": "Harga semasa",
      "cumulative": "Perubahan terkumpul sejak amaran",
      "peak": "Puncak"
    },
    "source_note": "Data daripada CoinGlass · harga dan dagangan di BingX · lilin daripada {exchange}",
    "guide": {
      "title": "Apakah empat faktor ini?",
      "zone": "Zone (30 mata) — kawasan nilai daripada profil volum 7 hari. Long mahukan harga rapat dengan tepi bawah, di mana volum terberat menjadi sokongan; short sebaliknya. Harga di luar kawasan nilai hanya dapat 4 mata — itu mengejar harga.",
      "sweep": "Sweep (20 mata) — lonjakan pembubaran ditambah pemulihan harga. Long mahukan pembubaran long melonjak (henti rugi di bawah telah disapu) dan harga sudah kembali naik; short sebaliknya. Tiada bukti pembubaran bermakna sifar.",
      "oi": "OI (30 mata) — faedah terbuka lawan harga, dalam empat kuadran. OI naik dengan harga naik bermakna long baharu, kes terbaik untuk long; OI naik dengan harga turun bermakna short baharu. Kedua-dua kuadran OI menurun mendapat mata rendah — tiada wang baharu di sebalik pergerakan itu.",
      "cvd": "CVD (20 mata) — beli tolak jual secara terkumpul. Separuh mata untuk arah, separuh untuk divergens: harga jatuh sementara CVD naik bermakna ada yang menyerap, isyarat long terkuat; harga naik sementara CVD jatuh ialah pengagihan.",
      "alert": "Amaran dicetuskan kali pertama skor melepasi 80 dan mengunci harga. Ia hanya ditutup selepas tiga imbasan berturut-turut di bawah 75 — penimbal itulah yang menghalang pencetusan berulang di sekitar garis 80."
    }
  },
```

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useScreenerData.ts src/i18n/messages/
git commit -m "feat(screener): 前端数据钩子与三语文案

钩子改成 useScannerData，一次请求同时拿榜单与未平警报——警报栏和
主表读的是同一份服务端快照，不会出现表里 85 分而警报卡还停在上一轮。

倒计时用服务端的 computedAt 而不是 react-query 的 dataUpdatedAt，
这样所有用户看到的下次扫描时间是一致的。

三个 locale 一起补。ms-MY 漏掉会让马来语页面整块缺键。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: 因子柱、筛选器与可排序表格

**Files:**
- Create: `src/components/screener/FactorStack.tsx`
- Create: `src/components/screener/ScreenerFilters.tsx`
- Modify: `src/components/ui/RecordList.tsx`

**Interfaces:**
- Consumes: `FactorBreakdown`、`FACTOR_MAX`、`CLIENT_SLIDER`
- Produces:
  - `FactorStack({ factors, size }: { factors: FactorBreakdown; size?: "sm" | "lg" })`
  - `FilterState = { volume: number; amplitude: number; marketCapFloor: number; direction: "all" | "long" | "short" }`
  - `DEFAULT_FILTERS: FilterState`
  - `ScreenerFilters({ value, onChange, count })`
  - `RecordColumn.sortKey?: string`、`RecordListProps.sort?: { key: string; dir: 1 | -1 }`、`onSortChange?`、`rowClassName?`

- [ ] **Step 1: 扩展 RecordList**

在 `src/components/ui/RecordList.tsx` 的 `RecordColumn` 里加一个字段：

```ts
  /** 设了这个键，表头就可点排序；不设的列（如"因子构成"）表头不可点 */
  sortable?: boolean;
```

在 `RecordListProps` 里加三个可选字段：

```ts
  /** 当前排序状态。不传就不显示排序箭头，表头也不可点。 */
  sort?: { key: string; dir: 1 | -1 };
  onSortChange?: (key: string) => void;
  /** 逐行追加的类名，用于把达标行高亮出来 */
  rowClassName?: (row: T) => string;
```

在桌面 `<th>` 上，当 `col.sortable && onSortChange` 时包一个 `<button>`（不要给 `<th>` 直接绑 onClick —— 那对键盘用户不可达），并在当前排序列后面渲染 `▼` / `▲`：

```tsx
                <th key={col.key} scope="col" className={/* 原有类名 */}>
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.key)}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gold"
                    >
                      {col.header}
                      {sort?.key === col.key && <span aria-hidden>{sort.dir === -1 ? "▼" : "▲"}</span>}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
```

并在桌面 `<tr>` 与手机 `<li>` 的 `className` 里追加 `rowClassName?.(row)`。

- [ ] **Step 2: 写 FactorStack**

创建 `src/components/screener/FactorStack.tsx`：

```tsx
import { cn } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { FactorBreakdown } from "@/lib/screener/types";

const ORDER = ["zone", "sweep", "oi", "cvd"] as const;

/**
 * 四根等高的槽，里面各填一段代表该因子得分占其满分的比例。
 *
 * 关键是**按各自满分归一**而不是按 30 分统一归一：Sweep 满分 20、
 * OI 满分 30，用同一个分母的话一个拿满 20 分的 Sweep 看起来会比
 * 一个拿 22 分的 OI 更矮，读者会以为它更差。
 */
export function FactorStack({
  factors,
  size = "sm",
  only,
}: {
  factors: FactorBreakdown;
  size?: "sm" | "lg";
  /** 只画其中一根。警报卡的因子明细是「一根柱配一个标签」，不是四根配一个标签。 */
  only?: keyof FactorBreakdown;
}) {
  const track = size === "lg" ? 30 : 20;
  const keys = only ? ([only] as const) : ORDER;

  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {keys.map((key) => {
        const ratio = Math.max(0, Math.min(1, factors[key] / FACTOR_MAX[key]));
        return (
          <i
            key={key}
            className="relative block w-[5px] rounded-[1px] bg-bg-tertiary"
            style={{ height: track }}
          >
            <b
              className={cn(
                "absolute bottom-0 left-0 block w-full rounded-[1px] bg-gold",
                // 最矮也留 3px：0 分和"没渲染出来"在视觉上必须能区分
                "min-h-[3px]"
              )}
              style={{ height: Math.max(3, Math.round(ratio * track)) }}
            />
          </i>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: 写 ScreenerFilters**

创建 `src/components/screener/ScreenerFilters.tsx`：

```tsx
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CLIENT_SLIDER } from "@/lib/screener/universe";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  /** 百万美元 */
  volume: number;
  /** 百分比 */
  amplitude: number;
  /** 百万美元 */
  marketCapFloor: number;
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  volume: CLIENT_SLIDER.volume.default,
  amplitude: CLIENT_SLIDER.amplitude.default,
  marketCapFloor: CLIENT_SLIDER.marketCapFloor.default,
  direction: "all",
};

const DIRECTIONS: DirectionFilter[] = ["all", "long", "short"];

export function ScreenerFilters({
  value,
  onChange,
  count,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  count: number;
}) {
  const t = useTranslations("screener");

  return (
    <div className="mb-4 flex flex-wrap items-end gap-5 rounded-lg panel px-4 py-3">
      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.volume")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.volume.min}
          max={CLIENT_SLIDER.volume.max}
          step={1}
          value={value.volume}
          onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.volume}</b>M USDT
        </span>
      </label>

      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.amplitude")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.amplitude.min}
          max={CLIENT_SLIDER.amplitude.max}
          step={0.5}
          value={value.amplitude}
          onChange={(e) => onChange({ ...value, amplitude: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.amplitude.toFixed(1)}</b>%
        </span>
      </label>

      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.market_cap")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.marketCapFloor.min}
          max={CLIENT_SLIDER.marketCapFloor.max}
          step={10}
          value={value.marketCapFloor}
          onChange={(e) => onChange({ ...value, marketCapFloor: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.marketCapFloor}</b>M – {CLIENT_SLIDER.marketCapCeiling}M
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.direction")}
        </span>
        <div className="flex overflow-hidden rounded-md border border-border-default">
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ ...value, direction: d })}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors",
                value.direction === d
                  ? "bg-gold/15 text-gold"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t(`filters.dir_${d === "all" ? "all" : d}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="tnum ml-auto text-xs text-text-secondary">
        {t("candidate_count", { count })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 这三个文件零错误

- [ ] **Step 5: 提交**

```bash
git add src/components/screener/FactorStack.tsx src/components/screener/ScreenerFilters.tsx src/components/ui/RecordList.tsx
git commit -m "feat(screener): 因子柱、筛选滑块与可排序表头

因子柱按各自满分归一而不是按 30 统一归一：Sweep 满分 20、OI 满分 30，
共用分母的话一个拿满 20 分的 Sweep 会比一个只拿 22 分的 OI 显得更矮，
读者会读反。最矮留 3px，让 0 分和「没渲染出来」在视觉上能区分。

排序表头包一层 button 而不是给 th 绑 onClick——后者对键盘用户完全不可达。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: 主扫描表、警报栏与页面

**Files:**
- Create: `src/components/screener/ScannerTable.tsx`
- Create: `src/components/screener/AlertCard.tsx`
- Create: `src/components/screener/AlertRail.tsx`
- Modify: `src/app/[locale]/(app)/screener/page.tsx`
- Delete: `src/components/screener/ScreenerTable.tsx`

**Interfaces:**
- Consumes: `ScannerRow`、`AlertRecord`、`FactorStack`、`ScreenerFilters`/`FilterState`/`DEFAULT_FILTERS`、`useScannerData`、`RecordList`
- Produces:
  - `SortKey = "symbol" | "direction" | "total" | "volumeUsd" | "amplitude" | "marketCap"`
  - `applyFilters(rows: ScannerRow[], f: FilterState): ScannerRow[]`
  - `sortRows(rows: ScannerRow[], key: SortKey, dir: 1 | -1): ScannerRow[]`
  - `ScannerTable({ rows, isLoading, onSelect, selectedSymbol })`
  - `AlertCard({ alert })`、`AlertRail({ alerts, selected })`

- [ ] **Step 1: 写筛选与排序的测试**

创建 `src/lib/screener/filter.ts` 与 `src/lib/screener/filter.test.ts`（放 `src/lib` 下，否则 vitest 不会收集）。

`src/lib/screener/filter.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "./filter";
import type { ScannerRow } from "./types";

function row(o: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
    price: 1,
    change24h: 1,
    amplitude: 4,
    volumeUsd: 20_000_000,
    marketCap: 300_000_000,
    marketCapRank: 120,
    fundingRate: 0,
    sourceExchange: "Binance",
    ...o,
  };
}

describe("applyFilters", () => {
  it("默认滑块下放行一个典型候选", () => {
    expect(applyFilters([row()], DEFAULT_FILTERS)).toHaveLength(1);
  });

  it("成交量滑块按百万美元换算后比较", () => {
    const f = { ...DEFAULT_FILTERS, volume: 25 };
    expect(applyFilters([row({ volumeUsd: 20_000_000 })], f)).toHaveLength(0);
    expect(applyFilters([row({ volumeUsd: 26_000_000 })], f)).toHaveLength(1);
  });

  it("振幅滑块过滤", () => {
    expect(applyFilters([row({ amplitude: 2 })], DEFAULT_FILTERS)).toHaveLength(0);
  });

  it("市值下限过滤，上限固定 500M", () => {
    expect(applyFilters([row({ marketCap: 20_000_000 })], DEFAULT_FILTERS)).toHaveLength(0);
    expect(applyFilters([row({ marketCap: 600_000_000 })], DEFAULT_FILTERS)).toHaveLength(0);
  });

  it("方向筛选", () => {
    const rows = [row({ direction: "long" }), row({ symbol: "X-USDT", direction: "short" })];
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, direction: "long" })).toHaveLength(1);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, direction: "short" })).toHaveLength(1);
    expect(applyFilters(rows, DEFAULT_FILTERS)).toHaveLength(2);
  });
});

describe("sortRows", () => {
  const rows = [row({ symbol: "A-USDT", total: 70 }), row({ symbol: "B-USDT", total: 90 })];

  it("降序把大的排前面", () => {
    expect(sortRows(rows, "total", -1)[0].symbol).toBe("B-USDT");
  });

  it("升序反过来", () => {
    expect(sortRows(rows, "total", 1)[0].symbol).toBe("A-USDT");
  });

  it("不修改入参数组", () => {
    const copy = [...rows];
    sortRows(rows, "total", -1);
    expect(rows).toEqual(copy);
  });

  it("symbol 按字典序而不是数值比较", () => {
    expect(sortRows(rows, "symbol", 1)[0].symbol).toBe("A-USDT");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/screener/filter.test.ts`
Expected: FAIL，`Failed to resolve import "./filter"`

- [ ] **Step 3: 写筛选实现**

创建 `src/lib/screener/filter.ts`：

```ts
import { CLIENT_SLIDER } from "./universe";
import type { ScannerRow } from "./types";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  /** 百万美元 */
  volume: number;
  /** 百分比 */
  amplitude: number;
  /** 百万美元 */
  marketCapFloor: number;
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  volume: CLIENT_SLIDER.volume.default,
  amplitude: CLIENT_SLIDER.amplitude.default,
  marketCapFloor: CLIENT_SLIDER.marketCapFloor.default,
  direction: "all",
};

export type SortKey = "symbol" | "direction" | "total" | "volumeUsd" | "amplitude" | "marketCap";

/**
 * 纯客户端过滤。服务端已经对整池算好分，这里只决定哪些行显示 ——
 * 拉动滑块不会改变任何币的分数，也不会改变警报触发。
 *
 * 滑块的单位是百万美元，行数据的单位是美元，比较前必须换算。
 * 这两个单位不统一是刻意的：滑块读数要给人看（"15M"），
 * 行数据要给计算用。
 */
export function applyFilters(rows: ScannerRow[], f: FilterState): ScannerRow[] {
  const minVolume = f.volume * 1_000_000;
  const minCap = f.marketCapFloor * 1_000_000;
  const maxCap = CLIENT_SLIDER.marketCapCeiling * 1_000_000;

  return rows.filter(
    (r) =>
      r.volumeUsd >= minVolume &&
      r.amplitude >= f.amplitude &&
      r.marketCap >= minCap &&
      r.marketCap <= maxCap &&
      (f.direction === "all" || r.direction === f.direction)
  );
}

/** 返回新数组 —— react 的列表渲染依赖引用变化，原地排序会让表格不更新。 */
export function sortRows(rows: ScannerRow[], key: SortKey, dir: 1 | -1): ScannerRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    return (Number(av) - Number(bv)) * dir;
  });
}
```

同时把 `src/components/screener/ScreenerFilters.tsx` 里自己声明的 `FilterState` / `DEFAULT_FILTERS` / `DirectionFilter` 删掉，改成从 `@/lib/screener/filter` 重新导出：

```ts
import type { FilterState, DirectionFilter } from "@/lib/screener/filter";
export type { FilterState, DirectionFilter };
export { DEFAULT_FILTERS } from "@/lib/screener/filter";
```

（组件里不能自己再定义一份 —— 两份定义漂移之后滑块和过滤逻辑会对不上，而 TS 不会报错。）

- [ ] **Step 4: 写 ScannerTable**

创建 `src/components/screener/ScannerTable.tsx`：

```tsx
"use client";

import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { formatPercent, cn } from "@/lib/utils";
import { formatCompactUsd } from "@/lib/market-cap";
import { ALERT_TRIGGER_SCORE } from "@/lib/screener/types";
import type { ScannerRow } from "@/lib/screener/types";
import type { SortKey } from "@/lib/screener/filter";
import { FactorStack } from "./FactorStack";

export const ScannerTable = memo(function ScannerTable({
  rows,
  isLoading,
  sort,
  onSortChange,
  onSelect,
  selectedSymbol,
}: {
  rows: ScannerRow[];
  isLoading: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
  onSortChange: (key: string) => void;
  onSelect: (row: ScannerRow) => void;
  selectedSymbol: string | null;
}) {
  const t = useTranslations("screener");

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const columns: RecordColumn<ScannerRow>[] = [
    {
      key: "symbol",
      header: t("columns.symbol"),
      primary: true,
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-display text-sm font-semibold text-text-primary">{r.coin}</span>
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            {r.sourceExchange}
          </span>
        </span>
      ),
    },
    {
      key: "direction",
      header: t("columns.direction"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
            r.direction === "long" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          )}
        >
          {r.direction === "long" ? "LONG" : "SHORT"}
        </span>
      ),
    },
    {
      key: "total",
      header: t("columns.total"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "tnum text-sm font-bold",
            r.total >= ALERT_TRIGGER_SCORE ? "text-gold" : "text-text-primary"
          )}
        >
          {r.total}
        </span>
      ),
    },
    {
      key: "factors",
      header: t("columns.factors"),
      hideOnMobile: true,
      render: (r) => <FactorStack factors={r.factors} />,
    },
    {
      key: "volumeUsd",
      header: t("columns.volume"),
      sortable: true,
      render: (r) => (
        <span className="tnum text-sm">{(r.volumeUsd / 1_000_000).toFixed(1)}M</span>
      ),
    },
    {
      key: "amplitude",
      header: t("columns.amplitude"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "tnum text-sm",
            r.change24h === null
              ? "text-text-secondary"
              : r.change24h >= 0
                ? "text-success"
                : "text-danger"
          )}
        >
          {r.amplitude.toFixed(1)}%
          {r.change24h !== null && (
            <span className="ml-1 text-xs opacity-70">{formatPercent(r.change24h)}</span>
          )}
        </span>
      ),
    },
    {
      key: "marketCap",
      header: t("columns.market_cap"),
      sortable: true,
      hideOnMobile: true,
      render: (r) => (
        <span className="tnum whitespace-nowrap text-sm">{formatCompactUsd(r.marketCap)}</span>
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (r) => (
        <Link href={`/trade?symbol=${r.symbol}&side=${r.direction}&market=futures`}>
          <Button
            variant={r.direction === "long" ? "green" : "red"}
            size="sm"
            className="min-h-[44px] px-2 text-xs lg:h-6"
          >
            {r.direction === "long" ? t("action_long") : t("action_short")}
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <RecordList
      rows={rows}
      columns={columns}
      rowKey={(r) => r.symbol}
      sort={sort}
      onSortChange={onSortChange}
      onRowClick={onSelect}
      empty={t("no_results")}
      rowClassName={(r) =>
        cn(
          // 达标行用金色左边框而不是整行底色：整行染色会和 hover / selected
          // 三种状态叠在一起，最后哪个都读不出来
          r.total >= ALERT_TRIGGER_SCORE && "border-l-2 border-l-gold",
          r.symbol === selectedSymbol && "bg-bg-tertiary"
        )
      }
    />
  );
});
```

- [ ] **Step 5: 写 AlertCard 与 AlertRail**

创建 `src/components/screener/AlertCard.tsx`：

```tsx
"use client";

import { useTranslations } from "next-intl";
import { cn, formatPrice } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { FactorStack } from "./FactorStack";

const FACTOR_LABELS = [
  ["zone", "Zone"],
  ["sweep", "Sweep"],
  ["oi", "OI"],
  ["cvd", "CVD"],
] as const;

function sinceLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export function AlertCard({ alert }: { alert: AlertRecord }) {
  const t = useTranslations("screener");
  const pct = alert.currentPct ?? 0;

  return (
    <div className="rounded-lg panel p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              alert.direction === "long" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
            )}
          >
            {alert.direction === "long" ? "LONG" : "SHORT"}
          </span>
          <span className="font-display text-sm font-semibold text-text-primary">
            {alert.symbol.replace(/-USDT$/, "")}
          </span>
        </div>
        <span className="text-[11px] text-text-muted">
          {sinceLabel(alert.triggeredAt)} {t("alerts.triggered")}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
        {t("alerts.trigger_line", {
          score: alert.triggerScore,
          zone: alert.factors.zone,
          sweep: alert.factors.sweep,
          oi: alert.factors.oi,
          cvd: alert.factors.cvd,
        })}
      </p>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.first_price")}
          </div>
          <div className="tnum text-sm text-text-secondary">{formatPrice(alert.triggerPrice)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t("alerts.last_price")}
          </div>
          <div className="tnum text-sm text-text-primary">
            {alert.lastPrice === null ? "—" : formatPrice(alert.lastPrice)}
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-md bg-bg-tertiary px-3 py-2 text-center">
        <div className={cn("tnum text-xl font-bold", pct >= 0 ? "text-success" : "text-danger")}>
          {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          {t("alerts.cumulative")}
          {alert.peakPct !== null && (
            <span className="ml-1.5">
              · {t("alerts.peak")} {alert.peakPct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        {FACTOR_LABELS.map(([key, label]) => (
          <div key={key} className="flex flex-col items-center gap-1">
            <FactorStack factors={alert.factors} size="lg" only={key} />
            <span className="text-[10px] text-text-muted">{label}</span>
            <span className="tnum text-[10px] text-text-secondary">
              {alert.factors[key]}/{FACTOR_MAX[key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

创建 `src/components/screener/AlertRail.tsx`：

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { AlertRecord } from "@/lib/screener/alerts-store";
import { AlertCard } from "./AlertCard";

export function AlertRail({ alerts }: { alerts: AlertRecord[] }) {
  const t = useTranslations("screener");

  return (
    <aside className="flex flex-col gap-3">
      <h2 className="text-[11px] uppercase tracking-wider text-text-muted">
        {t("alerts.rail_label")}
      </h2>
      {alerts.length === 0 ? (
        <p className="rounded-lg panel px-3.5 py-3 text-[11px] leading-relaxed text-text-secondary">
          {t("alerts.empty")}
        </p>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} />)
      )}
    </aside>
  );
}
```

- [ ] **Step 6: 改页面**

`src/app/[locale]/(app)/screener/page.tsx` 整个文件替换成：

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useScannerData } from "@/hooks/useScreenerData";
import { ScannerTable } from "@/components/screener/ScannerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { AlertRail } from "@/components/screener/AlertRail";
import { Button } from "@/components/ui/Button";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "@/lib/screener/filter";
import type { FilterState, SortKey } from "@/lib/screener/filter";

const FILTER_STORAGE_KEY = "chart-ix:scanner-filters";
const SORTABLE: SortKey[] = ["symbol", "direction", "total", "volumeUsd", "amplitude", "marketCap"];

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const tCalc = useTranslations("calculator");
  const locale = useLocale();
  const { rows, alerts, isLoading, error, isRefreshing, lastUpdated, refetch } = useScannerData();

  // 初值必须是 DEFAULT_FILTERS 而不是直接读 localStorage：服务端渲染时
  // 没有 localStorage，两边初值不一致会触发 hydration 不匹配。
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "total", dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
    } catch {
      // 存的是坏 JSON 就当没存过，不要让一条脏缓存把整页打崩
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // 隐私模式下 localStorage 会抛，滑块照常工作、只是不记忆
    }
  }, [filters]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => sortRows(applyFilters(rows, filters), sort.key, sort.dir),
    [rows, filters, sort]
  );

  const remaining = lastUpdated > 0 ? lastUpdated + SCAN_INTERVAL_MS - now : null;

  const handleSort = (key: string) => {
    if (!SORTABLE.includes(key as SortKey)) return;
    setSort((prev) =>
      prev.key === key ? { key: prev.key, dir: (prev.dir * -1) as 1 | -1 } : { key: key as SortKey, dir: -1 }
    );
  };

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-text-primary">
            {t("title")}
          </h1>
          <p className="text-[11px] tracking-wider text-text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 报错时不显示倒计时——那会是一个冻在 00:00 的假进度 */}
          {!error && remaining !== null && (
            <span className="tnum text-xs text-text-secondary">
              {t("next_scan")} {formatCountdown(remaining)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={refetch} disabled={isRefreshing}>
            {t("refresh_now")}
          </Button>
        </div>
      </div>

      <Link
        href={`/${locale}/tools/position-size`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-gold"
      >
        {tCalc("title")} →
      </Link>

      <details className="mb-4 rounded-lg panel">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-text-primary">
          {t("guide.title")}
        </summary>
        <div className="space-y-2.5 border-t border-border-default px-4 py-3 text-xs leading-relaxed text-text-secondary">
          <p>{t("guide.zone")}</p>
          <p>{t("guide.sweep")}</p>
          <p>{t("guide.oi")}</p>
          <p>{t("guide.cvd")}</p>
          <p className="rounded-sm bg-bg-tertiary px-3 py-2">{t("guide.alert")}</p>
        </div>
      </details>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-secondary">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <ScreenerFilters value={filters} onChange={setFilters} count={visible.length} />
            <section className="overflow-hidden rounded-lg border border-border-default bg-bg-primary">
              <div className="flex items-baseline gap-2 border-b border-border-default px-3 py-2">
                <h2 className="font-display text-sm font-semibold tracking-tight text-text-primary">
                  {t("table_title")}
                </h2>
                <span className="text-[11px] text-text-muted">{t("table_hint")}</span>
              </div>
              <ScannerTable
                rows={visible}
                isLoading={isLoading}
                sort={sort}
                onSortChange={handleSort}
                onSelect={(r) => setSelected(r.symbol)}
                selectedSymbol={selected}
              />
            </section>
          </div>
          <AlertRail alerts={alerts} />
        </div>
      )}
    </div>
  );
}
```

删掉旧表格：

```bash
git rm src/components/screener/ScreenerTable.tsx
```

- [ ] **Step 7: 跑测试与类型检查**

Run: `npm test -- src/lib/screener/filter.test.ts`
Expected: PASS，9 个用例全绿

Run: `npx tsc --noEmit`
Expected: 只剩 `src/lib/screener-scoring.test.ts` 的错误（该文件在 Task 18 删除）

- [ ] **Step 8: 提交**

```bash
git add -A src/components/screener src/app/[locale]/\(app\)/screener src/lib/screener/filter.ts src/lib/screener/filter.test.ts
git commit -m "feat(screener): 主扫描表、警报栏与页面

筛选与排序逻辑放在 src/lib/screener/filter.ts 而不是组件里，理由有二：
vitest 只收集 src/lib 下的测试文件；以及 FilterState 只能有一份定义——
组件里再声明一份，两边漂移之后滑块和过滤会对不上而 TS 不会报错。

达标行用金色左边框而不是整行底色：整行染色会和 hover、selected 三种
状态叠在一起，最后哪个都读不出来。

滑块初值是 DEFAULT_FILTERS 而不是直接读 localStorage——服务端渲染时
没有 localStorage，两边初值不一致会触发 hydration 不匹配。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: 退役旧模块、dryrun 脚本与全量验证

**Files:**
- Delete: `src/lib/screener-scoring.ts`、`src/lib/screener-scoring.test.ts`、`src/lib/screener-server.ts`
- Create: `scripts/screener-dryrun.mjs`
- Modify: `src/lib/instruments.ts`（注释里指向旧文件的引用）

- [ ] **Step 1: 删除旧模块**

```bash
git rm src/lib/screener-scoring.ts src/lib/screener-scoring.test.ts src/lib/screener-server.ts
```

改 `src/lib/instruments.ts` 第 7 行的注释，把 `src/lib/screener-scoring.ts 的 isSyntheticProduct` 改成 `src/lib/screener/universe.ts 的 isSyntheticProduct`。

- [ ] **Step 2: 确认没有任何残留引用**

Run: `npx tsc --noEmit`
Expected: 零错误

Run（在 Git Bash 里）: `grep -rn "screener-scoring\|screener-server\|ScreenerResult\|useScreenerData\b" src --include=*.ts --include=*.tsx`
Expected: 只剩 `src/hooks/useScreenerData.ts` 这个文件名本身（钩子文件名没改，导出的函数已改成 `useScannerData`）

- [ ] **Step 3: 写 dryrun 脚本**

创建 `scripts/screener-dryrun.mjs`：

```js
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

const started = Date.now();
const payload = await runScan();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n候选池 ${payload.rows.length} 个 · 耗时 ${elapsed}s\n`);
console.log("SYMBOL".padEnd(14), "DIR  ", "TOT", " Z  S  OI CVD", "  VOL(M)", " AMP%", "  CAP(M)", " SRC");

for (const r of payload.rows.slice(0, 40)) {
  const f = r.factors;
  console.log(
    r.coin.padEnd(14),
    r.direction.toUpperCase().padEnd(6),
    String(r.total).padStart(3),
    String(f.zone).padStart(3),
    String(f.sweep).padStart(2),
    String(f.oi).padStart(3),
    String(f.cvd).padStart(3),
    (r.volumeUsd / 1e6).toFixed(1).padStart(8),
    r.amplitude.toFixed(1).padStart(6),
    (r.marketCap / 1e6).toFixed(0).padStart(8),
    r.sourceExchange
  );
}

const qualified = payload.rows.filter((r) => r.total >= 80);
console.log(`\n≥80 分（会触发警报）：${qualified.length} 个 —— ${qualified.map((r) => r.coin).join(", ") || "无"}`);

// 分布是判断打分曲线松紧的唯一依据。全挤在 40–60 说明曲线太保守，
// 一大半 ≥80 说明门槛形同虚设。
const buckets = [0, 20, 40, 60, 80, 100];
for (let i = 0; i < buckets.length - 1; i++) {
  const n = payload.rows.filter((r) => r.total >= buckets[i] && r.total < buckets[i + 1]).length;
  console.log(`${buckets[i]}–${buckets[i + 1]}: ${"█".repeat(n)} ${n}`);
}
```

- [ ] **Step 4: 跑一轮真实 dryrun**

Run（把 `<key>` 换成真实 key，**不要写进任何文件**）:

```bash
COINGLASS_API_KEY=<key> npx tsx scripts/screener-dryrun.mjs
```

Expected: 打印出约 100–200 个候选、耗时在 30 秒以内、分数分布不是全挤在同一个桶里。
如果候选数远低于 100，先检查 CoinGecko 那一路（市值是硬门槛）；
如果 `SRC` 那一列大量出现 Binance 以外的交易所，说明 `pickExchangeRow` 的回落触发得比预期频繁，值得看一眼是不是 symbol 映射错了。

- [ ] **Step 5: 全量测试与构建**

Run: `npm test`
Expected: 全部通过

Run: `npx tsc --noEmit`
Expected: 零错误

Run: `npm run lint`
Expected: 零错误

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore(screener): 退役 6 维模型并补上 dryrun 脚本

screener-scoring.ts / screener-server.ts 及其测试整体删除。

dryrun 脚本是这套流水线唯一的端到端验证手段：pipeline.ts 全是网络编排，
写单元测试只能测到 mock 的行为，而真正会出问题的是「CoinGlass 某个
字段换了名字」「某个币在 Binance 没有合约」这类事，mock 永远发现不了。

脚本末尾打印分数分布——那是判断打分曲线松紧的唯一依据。全挤在
40–60 说明曲线太保守，一大半 ≥80 说明门槛形同虚设。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 上线检查清单

实施完成后按顺序做，缺一步都会让功能看起来「装好了但不工作」：

1. **Vercel 环境变量**：加 `COINGLASS_API_KEY`（Production + Preview），重新部署一次让它生效
2. **执行迁移 048**：在 Supabase 控制台跑 `supabase/migrations/048_screener_alerts.sql`。跑完用注释里那两条 SQL 验证 `cron.job` 里有 `screener-scan-tick`
3. **手动打一次扫描端点**确认能跑通：`curl https://chart-ix.com/api/cron/screener-scan`，应返回 `{"rows":…,"opened":…}` 而不是 500
4. **等 15 分钟再打一次**，应返回 `{"skipped":true,"reason":"not due"}` —— 这验证了门控生效
5. **开警报推送**（可选）：在 `admin_settings` 里把 `screener_alert_push` 设成 `{"enabled":true,"minScore":80}`。默认是关的
6. **提交 `.github/workflows/cron-tick.yml`** —— 这个文件目前还是 untracked，不提交的话 GitHub Actions 那条备份调度线根本不存在

---

## Spec 偏差记录

实施计划相对 `docs/superpowers/specs/2026-08-18-screener-coinglass-design.md` 有两处刻意的偏差，都需要在评审时确认：

**1. 不再调用 `liquidation/coin-list`。**
spec 的批量层列了这个端点，用途是给两段式「粗筛 → 精算 Top N」当预分数据源。既然方案选了 B（全量精算），Sweep 因子直接用每个币的 `liquidation/history` 30m 序列，`coin-list` 就没有任何消费者了。保留它等于每轮多拉 600KB 却没人读。批量层因此从 4 次调用降到 3 次。

**2. 主调度器改用 pg_cron，GitHub Actions 降级为备份。**
spec 写的是 GitHub Actions `*/5`，并如实记录了它有几分钟到十几分钟的漂移。但读迁移 047 时发现 pg_cron 现在是真的在跑的（047 在里面注册了 `daily-briefing-tick` 与 `telegram-screener-push` 两个任务，且把地址切到了 `chart-ix.com`）——047 之前那句「pg_cron 从未执行过」说的是 028 那个带占位符的模板，不是 pg_cron 本身不可用。pg_cron 的定时比 GitHub Actions 准得多，所以迁移 048 里注册 `screener-scan-tick`，同时保留 GitHub Actions 那一步当第二条腿。两条腿都打同一个端点，服务端的 15 分钟门控保证重复 tick 不会重复计算。

---

## Self-Review

**Spec 覆盖检查** —— 逐节对照，每条都有对应任务：

| Spec 章节 | 任务 |
|---|---|
| 上游能力/限制（30m 粒度、并发） | Task 1、2（常量与注释都钉死了） |
| 模块划分 | Task 1–3、9、11、12、16、17 |
| 三段式数据流 | Task 9 |
| 交易所口径（OI 用 All、K 线用 Binance 回落、费率用 BingX、价格用 BingX） | Task 2（`pickAggregatedOi`/`pickExchangeRow`）、Task 9（`PREFERRED_HISTORY_EXCHANGE`/`BINGX_EXCHANGE`）、Task 9（`pickFundingRate`） |
| Zone / Sweep / OI / CVD 四条曲线与全部拐点 | Task 4、5、6、7 |
| 方向 = 高分那边、总分 [0,100] | Task 8 |
| 服务端宽门槛 / 客户端窄滑块 + 包含关系断言 | Task 3（断言测试）、Task 17（`applyFilters`） |
| `screener_alerts` 表与 RLS | Task 10 |
| 警报状态机（触发 80 / 关闭 75 / 迟滞 3 / 方向翻转） | Task 11 |
| 只接 Telegram、不接 web-push、后台开关 + 最低分数 | Task 14 |
| 前端：单表 + 方向 pill + 因子柱 + 警报栏 + 操作列 + 三语 | Task 15、16、17 |
| 降级矩阵七条 | Task 9（前四条）、Task 12（缓存与兜底）、Task 4–7（各因子缺失分支） |
| 测试清单 | Task 1、3、4、5、6、7、8、9、11、13、14、17 |
| `COINGLASS_API_KEY` 不进仓库 | Global Constraints + Task 1 |
| 退役旧模块 + dryrun 脚本 | Task 18 |

**占位符扫描**：全文无 TBD / TODO / 「类似 Task N」/ 「补上错误处理」。每个代码步骤都给了可直接粘贴的完整代码。

**类型一致性核对**（跨任务引用的名字）：

- `ScannerRow` / `ScannerPayload` / `FactorBreakdown` / `Direction` 在 Task 3 定义，Task 8、9、11、13、15、17 引用，字段名一致
- `FACTOR_MAX` 在 Task 3 定义，Task 4–8、16、17 引用
- `runWithConcurrency` 在 Task 1 定义为「失败写 null、保持顺序」，Task 9 依赖这两条性质按下标对回 symbol
- `pickExchangeRow` / `pickAggregatedOi` 在 Task 2 定义，Task 9 引用
- `priceChangeOverBars` 在 Task 6 定义（`oi.ts`），Task 7 的 `cvd.ts` 从 `./oi` import —— 这是一条真实的跨因子依赖，实施时不要为了「因子之间不该互相引用」而复制一份
- `signedPct` 在 Task 11 定义（`alerts.ts`），Task 12 的 `alerts-store.ts` 引用
- `SERIES_LIMIT` 在 Task 2 定义（`price-history.ts`），Task 8 的 `amplitudeFromBars` 引用
- `FilterState` / `DEFAULT_FILTERS` 只在 Task 17 的 `filter.ts` 定义一份，Task 16 的组件改成重新导出 —— **Task 16 先写、Task 17 才收口，实施 Task 16 时会临时有一份重复定义，Task 17 的 Step 3 必须把它删掉**
- `showDirection` / `showFactors`（Task 13）对应 DB 列 `show_oi_ratio` / `show_edge`，三处（类型、读、写）必须一起改
- `useScannerData`（Task 15）替换 `useScreenerData`，文件名不变、导出名变 —— Task 17 的页面按新名字 import

---

## Task 19 附记（2026-08-18，真实 dryrun 后的返工）

Task 1–18 全部完成、评审通过、1017 个测试全绿之后，用真实 CoinGlass key 跑 dryrun 才发现
上面「Global Constraints」里「上游并发上限 120，上游不是瓶颈」这条结论是错的——真实约束是
响应头 `API-KEY-MAX-LIMIT: 80`，**每分钟 80 次请求**，不是并发数。当时的三段式流水线
（批量层 → 行情层对每个粗筛候选调 pairs-markets → 明细层对存活候选调 4 端点）一轮要打
450–800 次调用，超配额一个数量级；实测 60 个候选全部退化成同一个分
`35 = Z15 + S0 + OI15 + CVD5`（四因子全部走缺数据默认值），振幅全 0，直接 probe 单币端点
返回 `code 429`。

这次返工不改因子文件、警报状态机、缓存层、路由、任何前端文件，只改取数策略，四处：

1. **`src/lib/coinglass/client.ts`**：`COINGLASS_CONCURRENCY` 从 120 降到 12；新增滚动窗口
   限流器 `RollingWindowLimiter`（75 次/分钟，留 5 次余量），`coinglassGet` 内部 `await` 它；
   新增对信封 `code: "429"` 的一次性重试（等 2 秒，重试后仍 429 才抛错）。
2. **`src/lib/screener/universe.ts`**：`SERVER_GATE.minVolumeUsd`（CoinGlass 成交额门槛）删除，
   新增 `minBingxVolumeUsd = 2_000_000`（BingX quoteVolume 粗粒度门槛，定在长尾假数据带下方）；
   新增 `amplitudeFromTicker` 导出，供预排序算具体振幅数值。`DEEP_SCAN_LIMIT` 放在
   `src/lib/screener/types.ts`。
3. **新文件 `src/lib/screener/preselect-rank.ts`**：`liquidationAnomaly(liq1h, liq24h)`
   （除零保护，同 `factors/sweep.ts` 的 `spikeRatio` 一个道理）+ `rankForDeepScan(inputs, limit)`
   （爆仓异常度与振幅各占一半的百分位排序，绝不用绝对值缩放——长尾分布下绝对值缩放会让
   振幅那一半的信号被压成 0）。
4. **`src/lib/screener/pipeline.ts`**：批量层从 3 路加回 `liquidation/coin-list`（4 路，2 次
   CoinGlass 调用）；新增预排序步骤，从粗筛池子里选出 `DEEP_SCAN_LIMIT` 个；
   `pairs-markets` 从「对每个粗筛候选调用」改成「只对预排序选中的候选调用」；
   `toMarketStage` 删掉 `volumeUsd` 门槛；明细层 `base + 0..3` 的下标算术原样不动，
   `staged` 现在最多 `DEEP_SCAN_LIMIT` 个。

一轮调用量：`2（批量层）+ DEEP_SCAN_LIMIT × 5（明细层：pairs-markets + OI + price + taker
+ liquidation）`。第一版把 `DEEP_SCAN_LIMIT` 写死成 15（按 CoinGlass 文档的 80 算出
`2 + 15 × 5 = 77`），但限流器自己留了 5 次余量、真正生效的窗口是
`RATE_LIMIT_PER_MIN = 75`——`77 > 75`，真实 dryrun 复核时最后两次调用撞上限流器等待，
一轮跑到 60.7 秒，撞破 Vercel Hobby 的 60 秒函数上限。**修法：`DEEP_SCAN_LIMIT` 不再写死，
改成从 `RATE_LIMIT_PER_MIN` 用 `Math.floor` 推导**（`src/lib/screener/types.ts`），
当前配额下推导为 14（`2 + 14 × 5 = 72 ≤ 75`）；`types.test.ts` 用一条断言钉住
`2 + 5 × DEEP_SCAN_LIMIT ≤ RATE_LIMIT_PER_MIN` 这条不等式，防止这两个绑死的常量以后
再次各改各的、又踩一次同样的坑。

详细的「为什么」——为什么并发数不是真实约束、为什么是预排序而不是继续三段式、
为什么用百分位而不是绝对值缩放、预排序会漏掉什么、为什么 `DEEP_SCAN_LIMIT` 改成推导式
而不是写死的数字——都写在
`docs/superpowers/specs/2026-08-18-screener-coinglass-design.md` 对应章节
（限流 / 数据流 / 候选池与筛选 / 不在本次范围内）与上述四个源文件的行内注释里，
这里不重复。
