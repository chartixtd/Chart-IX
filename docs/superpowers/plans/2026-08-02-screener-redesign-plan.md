# Screener 重构实施计划（合约小市值双向筛选）

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有单方向、现货数据源的 screener 改造成"只做合约市场、排除市值前 50 大币、每小时自动重筛、同时输出做多优势/做空优势各 Top 10"的双向筛选页。

**Architecture:** 三阶段数据流：(1) 批量拉合约 24h ticker 做硬性淘汰；(2) 从新增的 `/api/market-cap` 路由（服务端 1 小时缓存的 CoinGecko 数据）拿市值 map，排除市值排名 ≤50 的大币，得到小币候选池；(3) 对候选池并行拉 OI + 资金费率，用同一份数据分别按做多/做空两套打分公式排序，各取 Top 10。所有筛选与打分逻辑放在纯函数模块（`src/lib/market-cap.ts`、`src/lib/screener-scoring.ts`）里，由 vitest 覆盖；React 层只负责取数与渲染。

**Tech Stack:** Next.js App Router (route handlers)、React Query (`@tanstack/react-query`)、next-intl、Tailwind、vitest（`vitest run`，配置只收集 `src/lib/**/*.test.ts` 与 `src/stores/**/*.test.ts`）。

## Global Constraints

- 只做合约市场。页面上不再有现货/合约切换；跳转链接一律 `market=futures`。
- 自动刷新间隔固定 1 小时：`SCREENER_REFRESH_MS = 3_600_000`。
- 市值排名 ≤ `TOP_MARKET_CAP_EXCLUDED = 50` 的币排除出候选池。
- 每组输出 `GROUP_SIZE = 10` 条。
- 市值数据整体不可用时不阻塞筛选：市值维度统一给 `MARKET_CAP_FALLBACK_SCORE = 50`，且不执行排名排除。
- 单个币在 CoinGecko 数据里查不到 → 不淘汰，市值维度给 100 分（视为极小盘）。
- 用 BingX symbol 查市值前必须先过 `normalizeSymbolForMarketCap()` 剥掉合约乘数前缀（BingX 把 SHIB 的千倍合约挂成 `1000SHIB-USDT`，直接拿去查会漏掉，导致 top-50 大币被当成微型盘）。
- 打分权重固定：市值 25%、振幅 20%、资金费率方向 20%、OI/量比 15%、24h 动量方向 10%、趋势位置 10%（合计 100）。
- 项目内 API 响应格式统一为 `{ success: boolean, data: T }` 或 `{ success: false, error: { code, message } }`。
- `BingXTicker.lastPrice` 类型是 `string | number`（现货返回 number，合约返回 string），任何读取都必须过 `Number()` / `parseFloat()`。
- i18n 三份文件必须同步改：`src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`。
- 测试命令：`npx vitest run <路径>`（单文件）或 `npm test`（全量）。

---

### Task 1: 市值纯函数模块

**Files:**
- Create: `src/lib/market-cap.ts`
- Test: `src/lib/market-cap.test.ts`

**Interfaces:**
- Consumes: 无（本任务是基础模块）
- Produces:
  - `interface CoinGeckoMarketRow { symbol: string; market_cap: number | null; market_cap_rank: number | null }`
  - `interface MarketCapEntry { marketCap: number; rank: number }`
  - `type MarketCapMap = Record<string, MarketCapEntry>`
  - `buildMarketCapMap(rows: CoinGeckoMarketRow[]): MarketCapMap`
  - `getMarketCapScore(entry: MarketCapEntry | undefined): number`
  - `formatCompactUsd(value: number): string`
  - 常量 `TOP_MARKET_CAP_EXCLUDED = 50`、`MARKET_CAP_FALLBACK_SCORE = 50`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/market-cap.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  buildMarketCapMap,
  getMarketCapScore,
  formatCompactUsd,
  TOP_MARKET_CAP_EXCLUDED,
  MARKET_CAP_FALLBACK_SCORE,
} from "./market-cap";

describe("buildMarketCapMap", () => {
  it("keys entries by the BingX perpetual symbol format", () => {
    const map = buildMarketCapMap([
      { symbol: "pepe", market_cap: 5_000_000_000, market_cap_rank: 25 },
    ]);
    expect(map["PEPE-USDT"]).toEqual({ marketCap: 5_000_000_000, rank: 25 });
  });

  // CoinGecko 里多个币可能共用同一个 ticker（例如山寨项目蹭名）。
  // 输入按 market_cap_desc 排序，所以第一次出现的就是市值最高的那个。
  it("keeps the first occurrence when two coins share a ticker", () => {
    const map = buildMarketCapMap([
      { symbol: "sol", market_cap: 80_000_000_000, market_cap_rank: 5 },
      { symbol: "sol", market_cap: 120_000, market_cap_rank: 4200 },
    ]);
    expect(map["SOL-USDT"].marketCap).toBe(80_000_000_000);
    expect(map["SOL-USDT"].rank).toBe(5);
  });

  it("skips rows with a null market cap or null rank", () => {
    const map = buildMarketCapMap([
      { symbol: "ghost", market_cap: null, market_cap_rank: 900 },
      { symbol: "phantom", market_cap: 1_000_000, market_cap_rank: null },
      { symbol: "real", market_cap: 1_000_000, market_cap_rank: 900 },
    ]);
    expect(map["GHOST-USDT"]).toBeUndefined();
    expect(map["PHANTOM-USDT"]).toBeUndefined();
    expect(map["REAL-USDT"]).toBeDefined();
  });

  it("skips rows with a non-positive market cap", () => {
    const map = buildMarketCapMap([
      { symbol: "zero", market_cap: 0, market_cap_rank: 900 },
    ]);
    expect(map["ZERO-USDT"]).toBeUndefined();
  });
});

describe("getMarketCapScore", () => {
  it("gives a full score when the coin is missing from CoinGecko data", () => {
    expect(getMarketCapScore(undefined)).toBe(100);
  });

  it("gives a full score at or below the $10M floor", () => {
    expect(getMarketCapScore({ marketCap: 10_000_000, rank: 900 })).toBe(100);
    expect(getMarketCapScore({ marketCap: 2_000_000, rank: 1500 })).toBe(100);
  });

  it("gives a zero score at or above the $2B ceiling", () => {
    expect(getMarketCapScore({ marketCap: 2_000_000_000, rank: 60 })).toBe(0);
    expect(getMarketCapScore({ marketCap: 50_000_000_000, rank: 8 })).toBe(0);
  });

  it("interpolates on a log scale between the floor and the ceiling", () => {
    // sqrt(10M * 2B) ≈ 141.42M —— log 区间正中点，应当接近 50 分
    const mid = getMarketCapScore({ marketCap: Math.sqrt(10_000_000 * 2_000_000_000), rank: 300 });
    expect(mid).toBeGreaterThan(49);
    expect(mid).toBeLessThan(51);
  });

  it("scores a smaller cap higher than a larger one", () => {
    const small = getMarketCapScore({ marketCap: 30_000_000, rank: 800 });
    const large = getMarketCapScore({ marketCap: 900_000_000, rank: 120 });
    expect(small).toBeGreaterThan(large);
  });
});

describe("formatCompactUsd", () => {
  it("formats billions, millions and thousands compactly", () => {
    expect(formatCompactUsd(2_400_000_000)).toBe("$2.40B");
    expect(formatCompactUsd(143_000_000)).toBe("$143.00M");
    expect(formatCompactUsd(52_000)).toBe("$52.00K");
    expect(formatCompactUsd(940)).toBe("$940.00");
  });
});

describe("constants", () => {
  it("matches the values the screener spec pins down", () => {
    expect(TOP_MARKET_CAP_EXCLUDED).toBe(50);
    expect(MARKET_CAP_FALLBACK_SCORE).toBe(50);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/market-cap.test.ts`
Expected: FAIL —— `Failed to resolve import "./market-cap"`

- [ ] **Step 3: 实现 `src/lib/market-cap.ts`**

```ts
/** CoinGecko /coins/markets 响应里我们唯一用到的三个字段 */
export interface CoinGeckoMarketRow {
  symbol: string;
  market_cap: number | null;
  market_cap_rank: number | null;
}

export interface MarketCapEntry {
  marketCap: number;
  rank: number;
}

/** key 形如 "PEPE-USDT"，与 BingX 永续合约 symbol 对齐 */
export type MarketCapMap = Record<string, MarketCapEntry>;

/** 市值排名在这个名次以内的币视为主流大币，排除出候选池 */
export const TOP_MARKET_CAP_EXCLUDED = 50;

/** 市值数据整体拿不到时，市值维度统一给的中性分 */
export const MARKET_CAP_FALLBACK_SCORE = 50;

const MARKET_CAP_FLOOR = 10_000_000;
const MARKET_CAP_CEILING = 2_000_000_000;

/**
 * 输入必须是按 market_cap_desc 排序的原始行：同一个 ticker 被多个币占用时，
 * 先出现的（市值最高的）才是我们要对应到 BingX 交易对上的那个。
 */
export function buildMarketCapMap(rows: CoinGeckoMarketRow[]): MarketCapMap {
  const map: MarketCapMap = {};
  for (const row of rows) {
    if (row.market_cap === null || row.market_cap <= 0) continue;
    if (row.market_cap_rank === null) continue;
    const key = `${row.symbol.toUpperCase()}-USDT`;
    if (map[key]) continue;
    map[key] = { marketCap: row.market_cap, rank: row.market_cap_rank };
  }
  return map;
}

/** 市值越小分越高。查不到市值的币按极小盘处理，给满分。 */
export function getMarketCapScore(entry: MarketCapEntry | undefined): number {
  if (!entry) return 100;
  const cap = entry.marketCap;
  if (cap <= MARKET_CAP_FLOOR) return 100;
  if (cap >= MARKET_CAP_CEILING) return 0;
  const t =
    (Math.log10(cap) - Math.log10(MARKET_CAP_FLOOR)) /
    (Math.log10(MARKET_CAP_CEILING) - Math.log10(MARKET_CAP_FLOOR));
  return 100 - t * 100;
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/market-cap.test.ts`
Expected: PASS（20 个断言全绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/market-cap.ts src/lib/market-cap.test.ts
git commit -m "feat(screener): add market cap mapping and scoring helpers"
```

---

### Task 2: `/api/market-cap` 服务端路由

**Files:**
- Create: `src/app/api/market-cap/route.ts`

**Interfaces:**
- Consumes: `CoinGeckoMarketRow` from `@/lib/market-cap`（Task 1）
- Produces: `GET /api/market-cap` → `{ success: true, data: CoinGeckoMarketRow[] }`，数组按 `market_cap_rank` 升序，约 1000 条

**背景说明（实现者需要知道的）：** CoinGecko 免费公开接口无需 API key，但有速率限制（大约每分钟 10-30 次）。这里一次拉 4 页 × 250 条 = 前 1000 名，靠 Next.js 的 `next: { revalidate: 3600 }` 做服务端缓存，保证每小时最多打 4 次。项目里其它路由的错误响应格式见 `src/app/api/bingx/market/openInterest/route.ts`。

- [ ] **Step 1: 创建路由文件**

创建 `src/app/api/market-cap/route.ts`：

```ts
import { NextResponse } from "next/server";
import type { CoinGeckoMarketRow } from "@/lib/market-cap";

const COINGECKO_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const PAGES = [1, 2, 3, 4];
const PER_PAGE = 250;
const CACHE_SECONDS = 3600;

interface RawRow {
  symbol?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
}

function normalize(rows: RawRow[]): CoinGeckoMarketRow[] {
  const out: CoinGeckoMarketRow[] = [];
  for (const row of rows) {
    if (typeof row?.symbol !== "string") continue;
    out.push({
      symbol: row.symbol,
      market_cap: typeof row.market_cap === "number" ? row.market_cap : null,
      market_cap_rank: typeof row.market_cap_rank === "number" ? row.market_cap_rank : null,
    });
  }
  return out;
}

async function fetchPage(page: number): Promise<CoinGeckoMarketRow[]> {
  const url = new URL(COINGECKO_MARKETS);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sparkline", "false");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: CACHE_SECONDS },
  });
  if (!res.ok) throw new Error(`CoinGecko page ${page} failed: ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`CoinGecko page ${page} returned a non-array body`);
  return normalize(json);
}

export async function GET() {
  const settled = await Promise.allSettled(PAGES.map(fetchPage));

  const rows: CoinGeckoMarketRow[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") rows.push(...result.value);
  }

  // 全部页都失败才算错误。部分页被限流时返回已拿到的部分，
  // 前端对"查不到市值的币"本来就有兜底（当作极小盘）。
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "MARKET_CAP_UNAVAILABLE", message: "CoinGecko market data unavailable" } },
      { status: 502 }
    );
  }

  rows.sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity));
  return NextResponse.json({ success: true, data: rows });
}
```

- [ ] **Step 2: 启动开发服务器并验证路由真的能取到数据**

用 preview 工具启动 dev server（不要用 Bash 跑 `npm run dev`）。若 `.claude/launch.json` 不存在，先创建：

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "chart-ix-dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }
  ]
}
```

然后 `preview_start` 启动 `chart-ix-dev`，再 `navigate` 到 `http://localhost:3000/api/market-cap`，用 `get_page_text` 检查响应。

Expected: 返回 `{"success":true,"data":[...]}`，`data` 长度接近 1000，第一条是 `{"symbol":"btc","market_cap":<数字>,"market_cap_rank":1}`。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/market-cap/route.ts .claude/launch.json
git commit -m "feat(screener): add cached CoinGecko market cap route"
```

---

### Task 3: 合约行情批量接口

**Files:**
- Modify: `src/lib/bingx/market.ts`（在文件末尾、`getFuturesFundingRate` 之后追加）
- Modify: `src/app/api/bingx/market/ticker/route.ts:11-14`
- Modify: `src/hooks/useMarketData.ts`（在 `useFuturesTicker` 之后追加）
- Test: `src/lib/bingx/market.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: 现有 `bingxClient.publicRequest`、`BingXTicker`
- Produces:
  - `getFuturesTickers(): Promise<BingXTicker[]>`（`src/lib/bingx/market.ts`）
  - `GET /api/bingx/market/ticker?market=futures`（不带 `symbol`）→ `{ success: true, data: BingXTicker[] }`
  - `useFuturesTickers()`（`src/hooks/useMarketData.ts`）→ React Query，`refetchInterval: SCREENER_REFRESH_MS`

**背景说明：** 现有 `getFuturesTicker(symbol)` 只查单个（[market.ts:127](../../../src/lib/bingx/market.ts)）。BingX 的 `/openApi/swap/v2/quote/ticker` 不传 `symbol` 时返回全量数组，行为与现货的 `getSpotTickers()` 一致。但现货单查接口曾经把对象包在长度 1 的数组里（见 `market.test.ts` 里 "Guards Finding 3" 那段注释），所以这里对返回体做一次防御性归一：非数组一律当空数组处理，不让上层拿到 `undefined.map`。

- [ ] **Step 1: 写失败测试**

在 `src/lib/bingx/market.test.ts` 顶部把导入改为包含新函数：

```ts
const { getSpotTicker, getSpotKlines, getFuturesKlines, getFuturesTickers } = await import("./market");
```

在文件末尾追加：

```ts
describe("getFuturesTickers", () => {
  it("requests the swap ticker endpoint without a symbol param", async () => {
    publicRequest.mockResolvedValue([]);
    await getFuturesTickers();
    expect(publicRequest).toHaveBeenCalledWith("/openApi/swap/v2/quote/ticker");
  });

  it("returns the array response as-is", async () => {
    publicRequest.mockResolvedValue([
      { symbol: "PEPE-USDT", lastPrice: "0.0000131", quoteVolume: "42000000" },
      { symbol: "WIF-USDT", lastPrice: "1.83", quoteVolume: "18000000" },
    ]);
    const tickers = await getFuturesTickers();
    expect(tickers).toHaveLength(2);
    expect(tickers[0].symbol).toBe("PEPE-USDT");
  });

  // 上层直接对结果 .filter/.map，非数组响应必须在这里被吃掉而不是穿透出去。
  it("returns an empty array when BingX responds with a non-array body", async () => {
    publicRequest.mockResolvedValue({ symbol: "PEPE-USDT" });
    expect(await getFuturesTickers()).toEqual([]);
  });

  it("returns an empty array when BingX responds with null", async () => {
    publicRequest.mockResolvedValue(null);
    expect(await getFuturesTickers()).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/bingx/market.test.ts`
Expected: FAIL —— `getFuturesTickers is not a function`

- [ ] **Step 3: 在 `src/lib/bingx/market.ts` 末尾追加实现**

```ts
/** 批量获取合约24小时行情（不传 symbol 时 BingX 返回全部永续合约） */
export async function getFuturesTickers(): Promise<BingXTicker[]> {
  const res = await bingxClient.publicRequest<BingXTicker[]>("/openApi/swap/v2/quote/ticker");
  return Array.isArray(res) ? res : [];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/bingx/market.test.ts`
Expected: PASS（原有用例 + 4 个新用例全绿）

- [ ] **Step 5: 让 ticker 路由的批量分支支持 futures**

修改 `src/app/api/bingx/market/ticker/route.ts`。把 import 行改为：

```ts
import { getSpotTicker, getSpotTickers, getFuturesTicker, getFuturesTickers } from "@/lib/bingx/market";
```

把批量分支（第 11-14 行）替换为：

```ts
    // 批量获取
    if (!symbol) {
      const data = market === "futures" ? await getFuturesTickers() : await getSpotTickers();
      return NextResponse.json({ success: true, data });
    }
```

- [ ] **Step 6: 加 `useFuturesTickers` hook**

在 `src/hooks/useMarketData.ts` 的 `useFuturesTicker` 函数之后追加：

```ts
// 合约批量行情 —— screener 专用。全市场几百个合约的快照体积不小，
// 且 screener 本身按小时重筛，所以刷新节奏跟 screener 对齐而不是跟现货列表对齐。
export function useFuturesTickers() {
  return useQuery({
    queryKey: ["bingx", "tickers", "futures"],
    queryFn: () => fetchApi<BingXTicker[]>("ticker", { market: "futures" }),
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });
}
```

同时在该文件的 import 区加上：

```ts
import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";
```

该常量 Task 4 才会随文件重写正式落位，为了不留下一个构建不过的中间状态，本任务先在 `src/lib/screener-scoring.ts` 顶部（现有 `import` 之后）插入这一行，Task 4 重写时原样保留：

```ts
/** screener 自动重新筛选间隔：1 小时 */
export const SCREENER_REFRESH_MS = 3_600_000;
```

- [ ] **Step 7: 验证类型与构建**

Run: `npx tsc --noEmit`
Expected: 无报错（若报到 screener 页面既有代码的错误，说明改动引入了不兼容，需要回看第 5、6 步）

- [ ] **Step 8: 提交**

```bash
git add src/lib/bingx/market.ts src/lib/bingx/market.test.ts src/app/api/bingx/market/ticker/route.ts src/hooks/useMarketData.ts src/lib/screener-scoring.ts
git commit -m "feat(screener): add batch futures ticker fetching"
```

---

### Task 4: 重写筛选与打分纯函数

**Files:**
- Modify（整体重写）: `src/lib/screener-scoring.ts`
- Test: `src/lib/screener-scoring.test.ts`（新建）

**Interfaces:**
- Consumes: `BingXTicker` from `@/types/bingx`；`MarketCapMap`、`MarketCapEntry`、`getMarketCapScore`、`normalizeSymbolForMarketCap`、`TOP_MARKET_CAP_EXCLUDED`、`MARKET_CAP_FALLBACK_SCORE` from `@/lib/market-cap`（Task 1）
- Produces:
  - `type Direction = "long" | "short"`
  - `const SCREENER_REFRESH_MS = 3_600_000`（Task 3 已加，保留）
  - `const GROUP_SIZE = 10`
  - `interface ScreenerResult`（字段见实现）
  - `interface ScreenerGroups { long: ScreenerResult[]; short: ScreenerResult[] }`
  - `hardFilter(ticker: BingXTicker, direction: Direction): boolean`
  - `isExcludedByMarketCap(entry: MarketCapEntry | undefined): boolean`
  - `selectCandidateSymbols(tickers: BingXTicker[], marketCapMap: MarketCapMap | null): string[]`
  - `computeScreenerGroups(tickers, oiMap, frMap, marketCapMap): ScreenerGroups`

**打分公式（六个维度，权重合计 100）：**

| 维度 | 权重 | 规则 |
|---|---|---|
| 市值 | 25% | `getMarketCapScore(entry)`；`marketCapMap === null` 时统一 `MARKET_CAP_FALLBACK_SCORE` |
| 振幅 | 20% | 2%–5% → 100；1.5%–2% → 线性 0→100；5%–12% → 线性 100→0；其它 → 0 |
| 资金费率方向 | 20% | `signed = direction === "long" ? -rate : rate`；`signed >= 0.0005` → 100；`signed <= -0.0005` → 0；中间线性 |
| OI/量比 | 15% | 0.3–1.5 → 100；<0.3 → `ratio/0.3*100`；1.5–3 → 线性 100→0；>3 → 0 |
| 24h 动量方向 | 10% | `signed = direction === "long" ? pct : -pct`；`signed <= 0` → 0；0–3 → 线性 0→100；3–15 → 线性 100→0；>15 → 0 |
| 趋势位置 | 10% | `pos = (last-low)/(high-low)`；`eff = direction === "long" ? pos : 1-pos`；`eff` 在 0.2–0.5 → 100；<0.2 → `eff/0.2*100`；>0.5 → 线性 100→0 |

- [ ] **Step 1: 写失败测试**

创建 `src/lib/screener-scoring.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  hardFilter,
  isExcludedByMarketCap,
  selectCandidateSymbols,
  computeScreenerGroups,
  GROUP_SIZE,
  SCREENER_REFRESH_MS,
} from "./screener-scoring";
import type { MarketCapMap } from "./market-cap";
import type { BingXTicker } from "@/types/bingx";

function ticker(overrides: Partial<BingXTicker> & { symbol: string }): BingXTicker {
  return {
    symbol: overrides.symbol,
    openPrice: overrides.openPrice ?? "1",
    highPrice: overrides.highPrice ?? "1.03",
    lowPrice: overrides.lowPrice ?? "1",
    lastPrice: overrides.lastPrice ?? "1.01",
    volume: overrides.volume ?? "1000",
    quoteVolume: overrides.quoteVolume ?? "50000000",
    priceChange: overrides.priceChange ?? "0.01",
    priceChangePercent: overrides.priceChangePercent ?? "1",
    closeTime: overrides.closeTime ?? Date.now(),
  };
}

describe("SCREENER_REFRESH_MS", () => {
  it("is one hour", () => {
    expect(SCREENER_REFRESH_MS).toBe(3_600_000);
  });
});

describe("hardFilter", () => {
  it("keeps a healthy mid-volume mover", () => {
    expect(hardFilter(ticker({ symbol: "WIF-USDT" }), "long")).toBe(false);
  });

  it("drops coins below the volume floor", () => {
    expect(hardFilter(ticker({ symbol: "DUST-USDT", quoteVolume: "500000" }), "long")).toBe(true);
  });

  it("drops flat coins whose 24h amplitude is under 1.5%", () => {
    const flat = ticker({ symbol: "FLAT-USDT", highPrice: "1.005", lowPrice: "1" });
    expect(hardFilter(flat, "long")).toBe(true);
  });

  it("drops already-pumped coins for the long side but keeps them for the short side", () => {
    const pumped = ticker({ symbol: "PUMP-USDT", priceChangePercent: "22", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(pumped, "long")).toBe(true);
    expect(hardFilter(pumped, "short")).toBe(false);
  });

  it("drops already-dumped coins for the short side but keeps them for the long side", () => {
    const dumped = ticker({ symbol: "DUMP-USDT", priceChangePercent: "-25", highPrice: "1.3", lowPrice: "1" });
    expect(hardFilter(dumped, "short")).toBe(true);
    expect(hardFilter(dumped, "long")).toBe(false);
  });

  it("drops rows with unparseable numbers", () => {
    expect(hardFilter(ticker({ symbol: "BAD-USDT", highPrice: "n/a" }), "long")).toBe(true);
  });

  it("drops rows with a non-positive low price", () => {
    expect(hardFilter(ticker({ symbol: "ZERO-USDT", lowPrice: "0" }), "long")).toBe(true);
  });
});

describe("isExcludedByMarketCap", () => {
  it("excludes coins ranked inside the top 50", () => {
    expect(isExcludedByMarketCap({ marketCap: 90_000_000_000, rank: 5 })).toBe(true);
    expect(isExcludedByMarketCap({ marketCap: 3_000_000_000, rank: 50 })).toBe(true);
  });

  it("keeps coins ranked outside the top 50", () => {
    expect(isExcludedByMarketCap({ marketCap: 400_000_000, rank: 51 })).toBe(false);
  });

  // 在 CoinGecko 前 1000 名里查不到 = 比第 1000 名还小，正是我们要的小币。
  it("keeps coins that are missing from the market cap data", () => {
    expect(isExcludedByMarketCap(undefined)).toBe(false);
  });
});

describe("selectCandidateSymbols", () => {
  const caps: MarketCapMap = {
    "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
    "WIF-USDT": { marketCap: 400_000_000, rank: 180 },
  };

  it("returns the union of long and short survivors without duplicates", () => {
    const tickers = [
      ticker({ symbol: "WIF-USDT" }),
      ticker({ symbol: "PUMP-USDT", priceChangePercent: "22", highPrice: "1.3", lowPrice: "1" }),
    ];
    const symbols = selectCandidateSymbols(tickers, caps);
    expect(symbols).toContain("WIF-USDT");
    expect(symbols).toContain("PUMP-USDT");
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("drops top-50 coins", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "BTC-USDT" })], caps);
    expect(symbols).toEqual([]);
  });

  it("keeps top-50 coins when market cap data is unavailable", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "BTC-USDT" })], null);
    expect(symbols).toEqual(["BTC-USDT"]);
  });

  it("ignores non-USDT pairs", () => {
    const symbols = selectCandidateSymbols([ticker({ symbol: "WIF-USDC" })], caps);
    expect(symbols).toEqual([]);
  });

  // BingX 把 SHIB 的千倍合约挂成 1000SHIB-USDT，而 CoinGecko 只认 shib。
  // 不剥乘数前缀的话，SHIB 这种 top-50 大币会整个绕过市值排除。
  it("drops a top-50 coin that BingX lists with a contract multiplier prefix", () => {
    const withShib: MarketCapMap = { ...caps, "SHIB-USDT": { marketCap: 6_000_000_000, rank: 20 } };
    const symbols = selectCandidateSymbols([ticker({ symbol: "1000SHIB-USDT" })], withShib);
    expect(symbols).toEqual([]);
  });

  // 1INCH 不是乘数命名，是真实币名，必须原样查得到。
  it("does not strip digits from genuine digit-leading token names", () => {
    const withInch: MarketCapMap = { "1INCH-USDT": { marketCap: 300_000_000, rank: 250 } };
    const symbols = selectCandidateSymbols([ticker({ symbol: "1INCH-USDT" })], withInch);
    expect(symbols).toEqual(["1INCH-USDT"]);
  });
});

describe("computeScreenerGroups", () => {
  const caps: MarketCapMap = {
    "BTC-USDT": { marketCap: 1_200_000_000_000, rank: 1 },
    "SMALL-USDT": { marketCap: 20_000_000, rank: 700 },
    "BIG-USDT": { marketCap: 1_800_000_000, rank: 70 },
  };

  it("excludes top-50 coins from both groups", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "BTC-USDT" })], {}, {}, caps);
    expect(groups.long).toEqual([]);
    expect(groups.short).toEqual([]);
  });

  it("ranks a smaller cap above a larger one when everything else matches", () => {
    const tickers = [ticker({ symbol: "SMALL-USDT" }), ticker({ symbol: "BIG-USDT" })];
    const oi = { "SMALL-USDT": 25_000_000, "BIG-USDT": 25_000_000 };
    const fr = { "SMALL-USDT": 0, "BIG-USDT": 0 };
    const groups = computeScreenerGroups(tickers, oi, fr, caps);
    expect(groups.long[0].symbol).toBe("SMALL-USDT");
    expect(groups.long[0].score).toBeGreaterThan(groups.long[1].score);
  });

  // 反转逻辑：费率为负 = 空头拥挤 = 潜在轧空 = 利好做多。
  it("favours negative funding on the long side and positive funding on the short side", () => {
    const tickers = [ticker({ symbol: "NEG-USDT" }), ticker({ symbol: "POS-USDT" })];
    const oi = { "NEG-USDT": 25_000_000, "POS-USDT": 25_000_000 };
    const fr = { "NEG-USDT": -0.0008, "POS-USDT": 0.0008 };
    const caps2: MarketCapMap = {
      "NEG-USDT": { marketCap: 100_000_000, rank: 300 },
      "POS-USDT": { marketCap: 100_000_000, rank: 300 },
    };
    const groups = computeScreenerGroups(tickers, oi, fr, caps2);
    expect(groups.long[0].symbol).toBe("NEG-USDT");
    expect(groups.short[0].symbol).toBe("POS-USDT");
  });

  it("caps each group at GROUP_SIZE entries", () => {
    const tickers = Array.from({ length: 25 }, (_, i) =>
      ticker({ symbol: `C${i}-USDT`, quoteVolume: String(10_000_000 + i * 1_000_000) })
    );
    const groups = computeScreenerGroups(tickers, {}, {}, {});
    expect(groups.long).toHaveLength(GROUP_SIZE);
    expect(groups.short).toHaveLength(GROUP_SIZE);
  });

  it("sorts each group by descending score", () => {
    const tickers = Array.from({ length: 6 }, (_, i) =>
      ticker({ symbol: `C${i}-USDT`, highPrice: String(1 + 0.02 * (i + 1)) })
    );
    const groups = computeScreenerGroups(tickers, {}, {}, {});
    const scores = groups.long.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("falls back to a neutral market cap score when the map is null", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, null);
    expect(groups.long).toHaveLength(1);
    expect(groups.long[0].marketCap).toBeNull();
    expect(groups.long[0].marketCapRank).toBeNull();
  });

  it("populates the result row from the ticker and detail maps", () => {
    const groups = computeScreenerGroups(
      [ticker({ symbol: "SMALL-USDT", lastPrice: "1.02", highPrice: "1.04", lowPrice: "1", quoteVolume: "50000000" })],
      { "SMALL-USDT": 25_000_000 },
      { "SMALL-USDT": -0.0004 },
      caps
    );
    const row = groups.long[0];
    expect(row.symbol).toBe("SMALL-USDT");
    expect(row.lastPrice).toBe(1.02);
    expect(row.quoteVolume).toBe(50_000_000);
    expect(row.amplitude).toBeCloseTo(4, 5);
    expect(row.openInterest).toBe(25_000_000);
    expect(row.fundingRate).toBe(-0.0004);
    expect(row.oiVolumeRatio).toBeCloseTo(0.5, 5);
    expect(row.marketCap).toBe(20_000_000);
    expect(row.marketCapRank).toBe(700);
    expect(row.score).toBeGreaterThan(0);
    expect(row.score).toBeLessThanOrEqual(100);
  });

  it("reads market cap through the multiplier-stripped symbol", () => {
    const withPepe: MarketCapMap = { "PEPE-USDT": { marketCap: 7_000_000_000, rank: 30 } };
    // rank 30 在前 50 内 —— 剥掉 1000 前缀后必须被排除
    const excluded = computeScreenerGroups([ticker({ symbol: "1000PEPE-USDT" })], {}, {}, withPepe);
    expect(excluded.long).toEqual([]);

    // 同一个币若排在 50 名之外，则应保留并带上真实市值
    const smallPepe: MarketCapMap = { "PEPE-USDT": { marketCap: 400_000_000, rank: 130 } };
    const kept = computeScreenerGroups([ticker({ symbol: "1000PEPE-USDT" })], {}, {}, smallPepe);
    expect(kept.long).toHaveLength(1);
    expect(kept.long[0].symbol).toBe("1000PEPE-USDT");
    expect(kept.long[0].marketCap).toBe(400_000_000);
    expect(kept.long[0].marketCapRank).toBe(130);
  });

  it("treats a missing OI or funding entry as zero rather than dropping the row", () => {
    const groups = computeScreenerGroups([ticker({ symbol: "SMALL-USDT" })], {}, {}, caps);
    expect(groups.long).toHaveLength(1);
    expect(groups.long[0].openInterest).toBe(0);
    expect(groups.long[0].fundingRate).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/screener-scoring.test.ts`
Expected: FAIL —— `isExcludedByMarketCap is not exported` 等一批导出缺失错误

- [ ] **Step 3: 整体重写 `src/lib/screener-scoring.ts`**

用以下内容**完整替换**该文件：

```ts
import type { BingXTicker } from "@/types/bingx";
import type { MarketCapEntry, MarketCapMap } from "@/lib/market-cap";
import {
  getMarketCapScore,
  normalizeSymbolForMarketCap,
  TOP_MARKET_CAP_EXCLUDED,
  MARKET_CAP_FALLBACK_SCORE,
} from "@/lib/market-cap";

export type Direction = "long" | "short";

/** screener 自动重新筛选间隔：1 小时 */
export const SCREENER_REFRESH_MS = 3_600_000;

/** 每个方向输出的条数 */
export const GROUP_SIZE = 10;

const MIN_QUOTE_VOLUME = 1_000_000;
const MIN_AMPLITUDE = 1.5;
const MAX_CHASE_PERCENT = 15;

export interface ScreenerResult {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  amplitude: number;
  marketCap: number | null;
  marketCapRank: number | null;
  openInterest: number;
  fundingRate: number;
  oiVolumeRatio: number;
  score: number;
}

export interface ScreenerGroups {
  long: ScreenerResult[];
  short: ScreenerResult[];
}

interface Parsed {
  high: number;
  low: number;
  last: number;
  quoteVolume: number;
  changePercent: number;
  amplitude: number;
}

function parse(ticker: BingXTicker): Parsed | null {
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const last = Number(ticker.lastPrice);
  const quoteVolume = parseFloat(ticker.quoteVolume);
  const changePercent = parseFloat(ticker.priceChangePercent);

  if (![high, low, last, quoteVolume, changePercent].every(Number.isFinite)) return null;
  if (low <= 0) return null;

  return { high, low, last, quoteVolume, changePercent, amplitude: ((high - low) / low) * 100 };
}

/** 硬性淘汰：触发任一规则返回 true（淘汰） */
export function hardFilter(ticker: BingXTicker, direction: Direction): boolean {
  const p = parse(ticker);
  if (!p) return true;
  if (p.quoteVolume < MIN_QUOTE_VOLUME) return true;
  if (p.amplitude < MIN_AMPLITUDE) return true;
  if (direction === "long" && p.changePercent > MAX_CHASE_PERCENT) return true;
  if (direction === "short" && p.changePercent < -MAX_CHASE_PERCENT) return true;
  return false;
}

/** 市值排名进前 50 的主流大币排除出候选池；查不到市值的不算大币 */
export function isExcludedByMarketCap(entry: MarketCapEntry | undefined): boolean {
  return entry !== undefined && entry.rank <= TOP_MARKET_CAP_EXCLUDED;
}

/** 做多池与做空池的并集，供上层按需拉 OI/资金费率 */
export function selectCandidateSymbols(
  tickers: BingXTicker[],
  marketCapMap: MarketCapMap | null
): string[] {
  const symbols = new Set<string>();
  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith("-USDT")) continue;
    const capKey = normalizeSymbolForMarketCap(ticker.symbol);
    if (marketCapMap && isExcludedByMarketCap(marketCapMap[capKey])) continue;
    if (!hardFilter(ticker, "long") || !hardFilter(ticker, "short")) {
      symbols.add(ticker.symbol);
    }
  }
  return [...symbols];
}

function amplitudeScore(amplitude: number): number {
  if (amplitude >= 2 && amplitude <= 5) return 100;
  if (amplitude >= MIN_AMPLITUDE && amplitude < 2) return ((amplitude - MIN_AMPLITUDE) / 0.5) * 100;
  if (amplitude > 5 && amplitude <= 12) return 100 - ((amplitude - 5) / 7) * 100;
  return 0;
}

/**
 * 反转逻辑：费率为负说明空头在付钱给多头（空头拥挤），对做多有利；反之亦然。
 * ±0.05% 是这里的饱和阈值。
 */
function fundingScore(fundingRate: number, direction: Direction): number {
  if (!Number.isFinite(fundingRate)) return 50;
  const signed = direction === "long" ? -fundingRate : fundingRate;
  if (signed >= 0.0005) return 100;
  if (signed <= -0.0005) return 0;
  return ((signed + 0.0005) / 0.001) * 100;
}

function oiRatioScore(ratio: number): number {
  if (ratio >= 0.3 && ratio <= 1.5) return 100;
  if (ratio < 0.3) return (ratio / 0.3) * 100;
  if (ratio <= 3) return 100 - ((ratio - 1.5) / 1.5) * 100;
  return 0;
}

/** 要有顺方向动量，但不能已经跑太远——3% 附近是甜点，越接近淘汰线 15% 分越低 */
function momentumScore(changePercent: number, direction: Direction): number {
  const signed = direction === "long" ? changePercent : -changePercent;
  if (signed <= 0) return 0;
  if (signed <= 3) return (signed / 3) * 100;
  if (signed <= MAX_CHASE_PERCENT) return 100 - ((signed - 3) / (MAX_CHASE_PERCENT - 3)) * 100;
  return 0;
}

/** 做多希望价格在日内区间的偏下半段（不接飞刀也不追高），做空反之 */
function positionScore(p: Parsed, direction: Direction): number {
  const raw = p.high > p.low ? (p.last - p.low) / (p.high - p.low) : 0.5;
  const clamped = Math.max(0, Math.min(1, raw));
  const eff = direction === "long" ? clamped : 1 - clamped;
  if (eff >= 0.2 && eff <= 0.5) return 100;
  if (eff < 0.2) return (eff / 0.2) * 100;
  return 100 - ((eff - 0.5) / 0.5) * 100;
}

function scoreToken(
  p: Parsed,
  direction: Direction,
  openInterest: number,
  fundingRate: number,
  marketCapScore: number
): number {
  const oiRatio = p.quoteVolume > 0 ? openInterest / p.quoteVolume : 0;
  return Math.round(
    marketCapScore * 0.25 +
      amplitudeScore(p.amplitude) * 0.2 +
      fundingScore(fundingRate, direction) * 0.2 +
      oiRatioScore(oiRatio) * 0.15 +
      momentumScore(p.changePercent, direction) * 0.1 +
      positionScore(p, direction) * 0.1
  );
}

function buildGroup(
  tickers: BingXTicker[],
  direction: Direction,
  oiMap: Record<string, number>,
  frMap: Record<string, number>,
  marketCapMap: MarketCapMap | null
): ScreenerResult[] {
  const rows: ScreenerResult[] = [];

  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith("-USDT")) continue;

    const entry = marketCapMap?.[normalizeSymbolForMarketCap(ticker.symbol)];
    if (marketCapMap && isExcludedByMarketCap(entry)) continue;
    if (hardFilter(ticker, direction)) continue;

    const p = parse(ticker);
    if (!p) continue;

    const openInterest = oiMap[ticker.symbol] ?? 0;
    const fundingRate = frMap[ticker.symbol] ?? 0;
    const marketCapScore = marketCapMap ? getMarketCapScore(entry) : MARKET_CAP_FALLBACK_SCORE;

    rows.push({
      symbol: ticker.symbol,
      lastPrice: p.last,
      priceChangePercent: p.changePercent,
      highPrice: p.high,
      lowPrice: p.low,
      quoteVolume: p.quoteVolume,
      amplitude: p.amplitude,
      marketCap: entry?.marketCap ?? null,
      marketCapRank: entry?.rank ?? null,
      openInterest,
      fundingRate,
      oiVolumeRatio: p.quoteVolume > 0 ? openInterest / p.quoteVolume : 0,
      score: scoreToken(p, direction, openInterest, fundingRate, marketCapScore),
    });
  }

  return rows.sort((a, b) => b.score - a.score).slice(0, GROUP_SIZE);
}

/** 一次算出做多优势 / 做空优势两组 Top N */
export function computeScreenerGroups(
  tickers: BingXTicker[],
  oiMap: Record<string, number>,
  frMap: Record<string, number>,
  marketCapMap: MarketCapMap | null
): ScreenerGroups {
  return {
    long: buildGroup(tickers, "long", oiMap, frMap, marketCapMap),
    short: buildGroup(tickers, "short", oiMap, frMap, marketCapMap),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/screener-scoring.test.ts src/lib/market-cap.test.ts`
Expected: PASS（两个文件全绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/screener-scoring.ts src/lib/screener-scoring.test.ts
git commit -m "feat(screener): rewrite scoring for dual-direction small-cap selection"
```

---

### Task 5: 数据 hooks 重写

**Files:**
- Create: `src/hooks/useMarketCap.ts`
- Modify（整体重写）: `src/hooks/useScreenerData.ts`

**Interfaces:**
- Consumes: `useFuturesTickers()`（Task 3）、`buildMarketCapMap` / `CoinGeckoMarketRow` / `MarketCapMap`（Task 1）、`selectCandidateSymbols` / `computeScreenerGroups` / `ScreenerGroups` / `SCREENER_REFRESH_MS`（Task 4）、`BingXOpenInterest` / `BingXFundingRate`（`@/types/bingx`，已存在）
- Produces:
  - `useMarketCap()` → React Query，`data: MarketCapMap | undefined`
  - `useScreenerData()` → `{ long, short, isLoading, isDetailLoading, marketCapUnavailable, error, lastUpdated, refetch }`
    - `long` / `short`: `ScreenerResult[]`
    - `lastUpdated`: `number`（ms epoch，0 表示还没有过成功响应）
    - `refetch`: `() => void`

**注意：** 现有 `useScreenerData(direction)` 带参数，新版**不带参数**。Task 7 会同步更新唯一调用点 `src/app/[locale]/screener/page.tsx`。本任务结束时该页面会报类型错误，属预期。

- [ ] **Step 1: 创建 `src/hooks/useMarketCap.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { buildMarketCapMap } from "@/lib/market-cap";
import type { CoinGeckoMarketRow, MarketCapMap } from "@/lib/market-cap";
import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";

export function useMarketCap() {
  return useQuery<MarketCapMap>({
    queryKey: ["market-cap"],
    queryFn: async () => {
      const res = await fetch("/api/market-cap");
      if (!res.ok) throw new Error(`Market cap request failed: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Market cap API error");
      return buildMarketCapMap(json.data as CoinGeckoMarketRow[]);
    },
    // 服务端已按 1 小时缓存，客户端跟着同一个节奏就够了
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS,
    retry: 1,
  });
}
```

- [ ] **Step 2: 整体重写 `src/hooks/useScreenerData.ts`**

用以下内容**完整替换**该文件：

```ts
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFuturesTickers } from "@/hooks/useMarketData";
import { useMarketCap } from "@/hooks/useMarketCap";
import {
  selectCandidateSymbols,
  computeScreenerGroups,
  SCREENER_REFRESH_MS,
} from "@/lib/screener-scoring";
import type { ScreenerResult } from "@/lib/screener-scoring";
import type { BingXOpenInterest, BingXFundingRate } from "@/types/bingx";

async function fetchApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`/api/bingx/market/${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data;
}

async function fetchDetailMap<T>(
  symbols: string[],
  endpoint: string,
  pick: (value: T) => number
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const settled = await Promise.allSettled(
    symbols.map((symbol) => fetchApi<T>(endpoint, { symbol }))
  );
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      const value = pick(result.value);
      if (Number.isFinite(value)) map[symbols[i]] = value;
    }
  });
  return map;
}

export interface ScreenerData {
  long: ScreenerResult[];
  short: ScreenerResult[];
  isLoading: boolean;
  isDetailLoading: boolean;
  marketCapUnavailable: boolean;
  error: Error | null;
  /** 最近一次 ticker 数据落地的时间，ms epoch；0 表示还没成功过 */
  lastUpdated: number;
  refetch: () => void;
}

export function useScreenerData(): ScreenerData {
  const tickersQuery = useFuturesTickers();
  const marketCapQuery = useMarketCap();

  // 市值请求彻底失败时不阻塞筛选：传 null 让打分退回中性分并跳过排名排除
  const marketCapMap = marketCapQuery.isError ? null : marketCapQuery.data ?? null;
  const marketCapReady = marketCapQuery.isError || marketCapQuery.data !== undefined;

  const candidateSymbols = useMemo(() => {
    if (!tickersQuery.data || !marketCapReady) return [];
    return selectCandidateSymbols(tickersQuery.data, marketCapMap);
  }, [tickersQuery.data, marketCapMap, marketCapReady]);

  const oiQuery = useQuery({
    queryKey: ["bingx", "screener", "oi", candidateSymbols],
    queryFn: () =>
      fetchDetailMap<BingXOpenInterest>(candidateSymbols, "openInterest", (v) =>
        parseFloat(v.openInterest)
      ),
    enabled: candidateSymbols.length > 0,
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });

  const frQuery = useQuery({
    queryKey: ["bingx", "screener", "fr", candidateSymbols],
    queryFn: () =>
      fetchDetailMap<BingXFundingRate>(candidateSymbols, "fundingRate", (v) =>
        parseFloat(v.lastFundingRate)
      ),
    enabled: candidateSymbols.length > 0,
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });

  const groups = useMemo(() => {
    if (!tickersQuery.data || !marketCapReady) return { long: [], short: [] };
    return computeScreenerGroups(
      tickersQuery.data,
      oiQuery.data ?? {},
      frQuery.data ?? {},
      marketCapMap
    );
  }, [tickersQuery.data, marketCapMap, marketCapReady, oiQuery.data, frQuery.data]);

  const isDetailLoading = candidateSymbols.length > 0 && (oiQuery.isPending || frQuery.isPending);

  return {
    long: groups.long,
    short: groups.short,
    isLoading: tickersQuery.isPending || !marketCapReady || isDetailLoading,
    isDetailLoading,
    marketCapUnavailable: marketCapQuery.isError,
    error: (tickersQuery.error as Error | null) ?? null,
    lastUpdated: tickersQuery.dataUpdatedAt,
    refetch: () => {
      tickersQuery.refetch();
      marketCapQuery.refetch();
      oiQuery.refetch();
      frQuery.refetch();
    },
  };
}
```

- [ ] **Step 3: 确认类型错误只剩下页面调用点**

Run: `npx tsc --noEmit`
Expected: 只报 `src/app/[locale]/screener/page.tsx` 相关的错误（`useScreenerData` 参数数量、`results` 属性不存在）。若有其他文件报错，说明改动越界，需回看第 1、2 步。

- [ ] **Step 4: 提交**

```bash
git add src/hooks/useMarketCap.ts src/hooks/useScreenerData.ts
git commit -m "feat(screener): rewire data hooks for futures dual-direction screening"
```

---

### Task 6: 表格组件改造

**Files:**
- Modify（整体重写）: `src/components/screener/ScreenerTable.tsx`

**Interfaces:**
- Consumes: `ScreenerResult` / `Direction`（Task 4）、`formatCompactUsd`（Task 1）、既有 `Skeleton`（`@/components/ui/Skeleton`）、`Button`（`@/components/ui/Button`）、`formatPrice` / `formatNumber` / `formatPercent` / `cn`（`@/lib/utils`）
- Produces: `<ScreenerTable results={ScreenerResult[]} isLoading={boolean} direction={Direction} />`

**改动要点：** 去掉全部排序交互（两组已经是按综合分排好的 Top 10，可排序会破坏"综合最优"语义）；新增市值列；操作列只渲染当前方向的一个按钮。

- [ ] **Step 1: 整体重写 `src/components/screener/ScreenerTable.tsx`**

用以下内容**完整替换**该文件：

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, formatPercent, cn } from "@/lib/utils";
import { formatCompactUsd } from "@/lib/market-cap";
import type { ScreenerResult, Direction } from "@/lib/screener-scoring";

const COLUMN_KEYS = [
  "rank",
  "symbol",
  "price",
  "change",
  "amplitude",
  "market_cap",
  "volume",
  "oi_volume_ratio",
  "funding_rate",
  "score",
  "actions",
] as const;

interface ScreenerTableProps {
  results: ScreenerResult[];
  isLoading: boolean;
  direction: Direction;
}

export function ScreenerTable({ results, isLoading, direction }: ScreenerTableProps) {
  const t = useTranslations("screener");

  const header = (
    <thead>
      <tr className="border-b border-border-default">
        {COLUMN_KEYS.map((key) => (
          <th
            key={key}
            className="px-3 py-2 text-xs font-medium text-text-secondary whitespace-nowrap text-left"
          >
            {key === "rank" ? "#" : t(`columns.${key}`)}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          {header}
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-border-default">
                {COLUMN_KEYS.map((key) => (
                  <td key={key} className="px-3 py-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
        <p className="text-sm">{t("no_results")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        {header}
        <tbody>
          {results.map((row, idx) => (
            <tr
              key={row.symbol}
              className="border-b border-border-default hover:bg-bg-tertiary transition-colors"
            >
              <td className="px-3 py-2.5 text-xs text-text-secondary">{idx + 1}</td>
              <td className="px-3 py-2.5 text-sm font-medium text-text-primary whitespace-nowrap">
                {row.symbol.replace("-USDT", "")}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatPrice(row.lastPrice)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-sm tabular-nums",
                  row.priceChangePercent >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatPercent(row.priceChangePercent)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.amplitude.toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums whitespace-nowrap">
                {row.marketCap === null ? "-" : formatCompactUsd(row.marketCap)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {formatNumber(row.quoteVolume, 0)}
              </td>
              <td className="px-3 py-2.5 text-sm text-text-primary tabular-nums">
                {row.oiVolumeRatio.toFixed(2)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-sm tabular-nums",
                  row.fundingRate >= 0 ? "text-success" : "text-danger"
                )}
              >
                {(row.fundingRate * 100).toFixed(4)}%
              </td>
              <td className="px-3 py-2.5 text-sm">
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold",
                    row.score >= 70
                      ? "bg-success/20 text-success"
                      : row.score >= 40
                        ? "bg-gold/20 text-gold"
                        : "bg-danger/20 text-danger"
                  )}
                >
                  {row.score}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <Link href={`/trade?symbol=${row.symbol}&side=${direction}&market=futures`}>
                  <Button
                    variant={direction === "long" ? "green" : "red"}
                    size="sm"
                    className="text-xs h-6 px-2"
                  >
                    {direction === "long" ? t("action_long") : t("action_short")}
                  </Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**顺带修掉的一个既有 bug：** 原文件用了 `text-green` / `text-red` / `bg-green/20` 这些类名，但 `tailwind.config.ts:28-31` 只定义了 `success` (#34C77B) 和 `danger` (#E5484D)，根本没有 `green` / `red`——原来那些涨跌配色其实一直没生效。上面统一改成 `success` / `danger`，与 `src/components/ui/Button.tsx` 的 variants 保持一致。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
git add src/components/screener/ScreenerTable.tsx
git commit -m "refactor(screener): make table single-direction with a market cap column"
```

---

### Task 7: 页面重写与 i18n

**Files:**
- Modify（整体重写）: `src/app/[locale]/screener/page.tsx`
- Modify: `src/i18n/messages/zh-CN.json:718-740`
- Modify: `src/i18n/messages/en-US.json:718-740`
- Modify: `src/i18n/messages/ms-MY.json:718-740`

**Interfaces:**
- Consumes: `useScreenerData()`（Task 5）、`<ScreenerTable>`（Task 6）、`SCREENER_REFRESH_MS`（Task 4）、既有 `Button`
- Produces: 完整可用的 `/[locale]/screener` 页面

- [ ] **Step 1: 替换 zh-CN 的 screener 段**

把 `src/i18n/messages/zh-CN.json` 第 718-740 行的整个 `"screener": { ... }` 块替换为：

```json
  "screener": {
    "title": "市场筛选器",
    "subtitle": "合约 · 小市值日内短线",
    "no_results": "当前没有符合条件的品种，请稍后再试",
    "error": "数据加载失败",
    "retry": "重试",
    "refresh_now": "立即刷新",
    "next_refresh": "下次刷新",
    "long_group": "做多优势 Top 10",
    "short_group": "做空优势 Top 10",
    "market_cap_unavailable": "市值数据暂不可用，市值维度按默认分计算",
    "columns": {
      "rank": "排名",
      "symbol": "币种",
      "price": "价格",
      "change": "24h涨跌",
      "amplitude": "振幅",
      "market_cap": "市值",
      "volume": "成交量",
      "oi_volume_ratio": "OI/量",
      "funding_rate": "费率",
      "score": "评分",
      "actions": "操作"
    },
    "action_long": "做多",
    "action_short": "做空"
  },
```

- [ ] **Step 2: 替换 en-US 的 screener 段**

把 `src/i18n/messages/en-US.json` 第 718-740 行的整个 `"screener": { ... }` 块替换为：

```json
  "screener": {
    "title": "Market Screener",
    "subtitle": "Futures · small-cap intraday setups",
    "no_results": "No coins match the current criteria. Please try again later.",
    "error": "Failed to load data",
    "retry": "Retry",
    "refresh_now": "Refresh now",
    "next_refresh": "Next refresh",
    "long_group": "Long Setups Top 10",
    "short_group": "Short Setups Top 10",
    "market_cap_unavailable": "Market cap data is unavailable; that dimension uses a neutral score.",
    "columns": {
      "rank": "Rank",
      "symbol": "Symbol",
      "price": "Price",
      "change": "24h Change",
      "amplitude": "Amplitude",
      "market_cap": "Mkt Cap",
      "volume": "Volume",
      "oi_volume_ratio": "OI/Vol",
      "funding_rate": "Funding",
      "score": "Score",
      "actions": "Actions"
    },
    "action_long": "Long",
    "action_short": "Short"
  },
```

- [ ] **Step 3: 替换 ms-MY 的 screener 段**

把 `src/i18n/messages/ms-MY.json` 第 718-740 行的整个 `"screener": { ... }` 块替换为：

```json
  "screener": {
    "title": "Penapis Pasaran",
    "subtitle": "Niaga Hadapan · syiling kecil untuk dagangan harian",
    "no_results": "Tiada syiling yang memenuhi kriteria. Sila cuba lagi nanti.",
    "error": "Gagal memuatkan data",
    "retry": "Cuba Lagi",
    "refresh_now": "Segar Semula",
    "next_refresh": "Segar semula seterusnya",
    "long_group": "Peluang Beli Top 10",
    "short_group": "Peluang Jual Top 10",
    "market_cap_unavailable": "Data permodalan pasaran tidak tersedia; dimensi itu guna skor neutral.",
    "columns": {
      "rank": "Kedudukan",
      "symbol": "Simbol",
      "price": "Harga",
      "change": "24j Ubah",
      "amplitude": "Amplitud",
      "market_cap": "Permodalan",
      "volume": "Volum",
      "oi_volume_ratio": "OI/Vol",
      "funding_rate": "Pembiayaan",
      "score": "Skor",
      "actions": "Tindakan"
    },
    "action_long": "Beli",
    "action_short": "Jual"
  },
```

- [ ] **Step 4: 整体重写页面**

用以下内容**完整替换** `src/app/[locale]/screener/page.tsx`：

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useScreenerData } from "@/hooks/useScreenerData";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { Button } from "@/components/ui/Button";
import { SCREENER_REFRESH_MS } from "@/lib/screener-scoring";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ScreenerPage() {
  const t = useTranslations("screener");
  const { long, short, isLoading, marketCapUnavailable, error, lastUpdated, refetch } =
    useScreenerData();

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = lastUpdated > 0 ? lastUpdated + SCREENER_REFRESH_MS - now : null;

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
          <p className="text-xs text-text-secondary mt-0.5">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {remaining !== null && (
            <span className="text-xs text-text-secondary tabular-nums">
              {t("next_refresh")} {formatCountdown(remaining)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={refetch}>
            {t("refresh_now")}
          </Button>
        </div>
      </div>

      {marketCapUnavailable && (
        <p className="mb-3 rounded-sm border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
          {t("market_cap_unavailable")}
        </p>
      )}

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-secondary">
          <p className="text-sm">{t("error")}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
            <h2 className="border-b border-border-default px-3 py-2 text-sm font-semibold text-success">
              {t("long_group")}
            </h2>
            <ScreenerTable results={long} isLoading={isLoading} direction="long" />
          </section>
          <section className="rounded-lg border border-border-default bg-bg-primary overflow-hidden">
            <h2 className="border-b border-border-default px-3 py-2 text-sm font-semibold text-danger">
              {t("short_group")}
            </h2>
            <ScreenerTable results={short} isLoading={isLoading} direction="short" />
          </section>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 跑全量测试和类型检查**

Run: `npm test`
Expected: 全部 PASS

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 6: 在浏览器里验证页面真的工作**

用 preview 工具（Task 2 已建好 `.claude/launch.json`）启动 `chart-ix-dev`，navigate 到 `http://localhost:3000/zh-CN/screener`，然后：

1. `read_console_messages`（`onlyErrors: true`）—— 期望没有报错
2. `read_page` —— 期望看到两个 section 标题「做多优势 Top 10」「做空优势 Top 10」，各自表格有数据行；表头包含「市值」列
3. `read_network_requests`（`urlPattern: "market-cap"`）—— 期望 `/api/market-cap` 返回 200
4. 检查两组的币种不是 BTC/ETH/SOL 这类主流大币（市值排除生效）
5. `resize_window`（`preset: "mobile"`）—— 期望两个表格堆叠成上下，页面 body 不出现横向滚动（表格自身可横向滚动）
6. `computer` 截图存证

若某一步失败，读源码定位后修改源文件，再从第 1 步重新检查。

- [ ] **Step 7: 提交**

```bash
git add "src/app/[locale]/screener/page.tsx" src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(screener): show side-by-side long and short setup groups"
```

---

## 自检记录

**Spec 覆盖：**

| Spec 要求 | 对应任务 |
|---|---|
| 只做合约、去掉现货切换 | Task 3（批量合约接口）、Task 7（页面去掉切换 UI） |
| 排除市值前 50 | Task 1（`TOP_MARKET_CAP_EXCLUDED`）、Task 4（`isExcludedByMarketCap`） |
| 市值越小加分越高 | Task 1（`getMarketCapScore`）、Task 4（25% 权重） |
| 每小时自动重筛 + 手动刷新 | Task 3/4（`SCREENER_REFRESH_MS`）、Task 5（`refetchInterval`）、Task 7（倒计时 + 立即刷新） |
| 两组各 Top 10 | Task 4（`GROUP_SIZE`、`computeScreenerGroups`） |
| CoinGecko 4 页 + 1h 服务端缓存 | Task 2 |
| symbol 去重映射（同 ticker 保留市值最高） | Task 1（`buildMarketCapMap`） |
| 查不到市值 → 不淘汰、市值给 100 分 | Task 1（`getMarketCapScore(undefined)`）、Task 4（`isExcludedByMarketCap(undefined)`） |
| 市值整体失败 → 不阻塞、退回 50 分 | Task 5（`marketCapMap = null`）、Task 4（`MARKET_CAP_FALLBACK_SCORE`）、Task 7（提示条） |
| 三阶段流程（ticker → 市值过滤 → OI/费率） | Task 5（`selectCandidateSymbols` 驱动第三轮） |
| 六个打分维度与权重 | Task 4 |
| 硬性淘汰 5 条规则 | Task 4（前 4 条在 `hardFilter`，市值那条在 `isExcludedByMarketCap`） |
| 左右并排、窄屏堆叠 | Task 7（`grid-cols-1 xl:grid-cols-2`） |
| 去掉排序交互 | Task 6 |
| 每行单方向按钮 | Task 6（`direction` prop） |
| 新增市值列 | Task 6 |
| 两个表格独立骨架屏/空状态 | Task 6（组件内各自处理） |
| i18n 三语同步 | Task 7 |
| 纯函数单测 | Task 1、Task 4 |
