# Screener 改为中央统计 + 榜单说明面板

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** 把 screener 的三阶段流水线从「每个用户的浏览器里各算一遍」搬到服务端算一次、全站共享；同时去掉副标题，加一个可折叠的「怎么看这个榜单」说明面板。

**Architecture:** 新增 `GET /api/screener`，服务端直接调用 `src/lib/bingx/market.ts` 的函数（不再经过 `/api/bingx/market/*` 代理多跳一次），跑完整条流水线后把结果放进一个带 TTL 和请求合并的内存缓存。前端 `useScreenerData` 退化成「读这一个接口」。打分逻辑（`screener-scoring.ts`）**一行不动**。

**Tech Stack:** Next.js 15 App Router route handler、React Query、vitest、next-intl。

## Global Constraints

- 打分/筛选纯函数 `src/lib/screener-scoring.ts` 与 `src/lib/market-cap.ts` **禁止修改**。本次只搬运执行位置，不改算法。
- 缓存 TTL = `SCREENER_REFRESH_MS`（1 小时）。
- **请求合并**：缓存未命中时若有 N 个并发请求，只能触发 **1 次**上游计算，其余等同一个 Promise。
- 计算失败**不得污染缓存**：下次请求要能重新尝试；但若已有过期的旧结果，宁可返回旧结果也不要报错（stale-while-error）。
- 「立即刷新」= 重新读这个接口，**不是**强制服务端重算。任何用户都不能通过点按钮触发全站重算。
- 服务端取 OI/资金费率同样保持**并发上限 8**。
- 响应格式沿用 `{ success: boolean, data: T }`。
- 三份 i18n（`zh-CN` / `en-US` / `ms-MY`）key 集合必须完全一致。
- 颜色只有 `success` / `danger` / `gold` / `text-text-*`，没有 `green` / `red`。

---

### Task 1: TTL + 请求合并缓存（纯逻辑，可测）

**Files:** Create `src/lib/ttl-cache.ts`, `src/lib/ttl-cache.test.ts`

**Produces:** `createTtlCache<T>(opts): { get(): Promise<T>; peek(): { at: number; data: T } | null }`

```ts
export interface TtlCacheOptions<T> {
  ttlMs: number;
  compute: () => Promise<T>;
  /** 注入时钟，方便测试 */
  now?: () => number;
}

export function createTtlCache<T>({ ttlMs, compute, now = Date.now }: TtlCacheOptions<T>) {
  let cached: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      if (cached && now() - cached.at < ttlMs) return cached.data;
      // 已有人在算就搭同一班车——冷缓存时 N 个并发请求只触发 1 次上游计算
      if (inflight) return inflight;

      inflight = compute().then(
        (data) => { cached = { at: now(), data }; inflight = null; return data; },
        (err) => {
          inflight = null;
          // 有旧结果就先顶着用（stale-while-error），别让一次上游抖动把整页打空
          if (cached) return cached.data;
          throw err;
        }
      );
      return inflight;
    },
    peek: () => cached,
  };
}
```

**测试**（`src/lib/ttl-cache.test.ts`，用注入的假时钟）：
- 首次调用触发一次 compute；TTL 内再调用不再触发（compute 调用次数仍为 1）
- 时钟推过 TTL 后再调用会重新触发（次数变 2）
- **并发合并**：不 await 地同时发起 5 次 `get()`，compute 只被调用 1 次，5 个 Promise 拿到同一个值
- compute 抛错且无旧结果 → `get()` reject，且**下一次调用会重新尝试**（不缓存失败）
- compute 抛错但有旧结果 → 返回旧结果，不抛
- `peek()` 在首次计算前返回 `null`

---

### Task 2: 服务端流水线 + `/api/screener` 路由

**Files:** Create `src/lib/screener-server.ts`, `src/app/api/screener/route.ts`
**Consumes:** Task 1 的 `createTtlCache`；现有 `src/lib/bingx/market.ts`、`src/lib/market-cap.ts`、`src/lib/screener-scoring.ts`

**`src/lib/screener-server.ts`** —— 把现在 `useScreenerData` 做的事原样搬到服务端：

```ts
export interface ScreenerPayload {
  long: ScreenerResult[];
  short: ScreenerResult[];
  /** 这份结果的计算时间，ms epoch —— 前端用它算倒计时 */
  computedAt: number;
  marketCapUnavailable: boolean;
}
```

`computeScreenerPayload(): Promise<ScreenerPayload>` 的步骤，与前端原逻辑一一对应：

1. 并发取 `getFuturesTickers()`、`getSpotTickers()`、CoinGecko 市值行
   - 市值那一路复用 `/api/market-cap` 已有的取数逻辑。**把该路由里的取数部分抽成 `fetchMarketCapRows(): Promise<CoinGeckoMarketRow[]>` 导出**，路由和这里共用，不要复制粘贴，也不要让服务端 HTTP 请求自己的路由。
   - 市值这一路失败或 `hasTopRankCoverage` 不通过 → `marketCapMap = null`、`marketCapUnavailable = true`，**不中断流程**
2. `buildMarketCapMap(rows)`；空 map 归一成 `null`（与前端同样的理由：空对象是真值，会让每个币白拿满分）
3. `buildChange24hMap(futuresTickers, spotTickers)`；现货失败则空 map（降级，不报错）
4. `selectCandidateSymbols(futuresTickers, marketCapMap, change24hMap).sort()`
5. 对候选池取 OI 与资金费率，**并发上限 8**，用 `getFuturesOpenInterest` / `getFuturesFundingRate` 直接调用（不走 HTTP 代理）。逐个失败用 `allSettled` 吞掉，只收有限值
6. `computeScreenerGroups(futuresTickers, oiMap, frMap, marketCapMap, change24hMap)`
7. 返回，`computedAt: Date.now()`

失败语义：只有**合约 ticker** 这一路失败才让整个 `computeScreenerPayload` 抛错（没有它无法产出任何结果）。现货、市值、OI、费率任一失败都降级处理。

模块末尾建缓存单例：

```ts
const screenerCache = createTtlCache<ScreenerPayload>({
  ttlMs: SCREENER_REFRESH_MS,
  compute: computeScreenerPayload,
});

export function getScreenerPayload() {
  return screenerCache.get();
}
```

**`src/app/api/screener/route.ts`**：

```ts
import { NextResponse } from "next/server";
import { getScreenerPayload } from "@/lib/screener-server";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getScreenerPayload();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "SCREENER_UNAVAILABLE", message: String(error) } },
      { status: 502 }
    );
  }
}
```

**验证**（不能只靠类型检查）：用 preview 工具起 dev server，连打两次 `/api/screener`，报告里写出：两次的 `computedAt` **完全相同**（证明第二次走的是缓存）、第二次响应明显更快、`long`/`short` 各 10 条且币种是真实加密货币。

---

### Task 3: 前端接入 + 去副标题 + 说明面板

**Files:** Modify `src/hooks/useScreenerData.ts`（重写）、`src/app/[locale]/screener/page.tsx`、三份 i18n
**Consumes:** Task 2 的 `/api/screener` 与 `ScreenerPayload`

**`useScreenerData` 重写**：删掉 `useFuturesTickers`/`useSpotTickers`/`useMarketCap`/两个明细查询/`fetchDetailMap`/`DETAIL_CONCURRENCY` 以及所有 `useMemo` 派生——这些现在都在服务端。整个 hook 变成一个 `useQuery`：

```ts
export function useScreenerData(): ScreenerData {
  const query = useQuery<ScreenerPayload>({
    queryKey: ["screener"],
    queryFn: async () => { /* fetch /api/screener，检查 json.success */ },
    refetchInterval: SCREENER_REFRESH_MS,
    staleTime: SCREENER_REFRESH_MS / 2,
  });
  ...
}
```

对外返回的 `ScreenerData` 字段名**保持不变**（`long` / `short` / `isLoading` / `marketCapUnavailable` / `error` / `isRefreshing` / `lastUpdated` / `refetch`），这样 `page.tsx` 那部分不用大改。其中：
- `lastUpdated` 取 `query.data.computedAt`（服务端时间），不再取客户端的 `dataUpdatedAt` —— 倒计时因此对所有用户一致
- `isRefreshing` = `query.isFetching`
- `isDetailLoading` 这个字段现在没有意义了，从接口里删掉，并同步删掉 `page.tsx` 里的引用（如果有）

**`page.tsx`**：
1. 删掉 `{t("subtitle")}` 那一行及其外层元素
2. 在标题区下方、表格上方插入可折叠说明面板，默认折叠，用 `useState` 控制：

```tsx
      <details className="mb-4 rounded-lg border border-border-default bg-bg-secondary">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-text-primary">
          {t("guide.title")}
        </summary>
        <div className="space-y-3 border-t border-border-default px-4 py-3 text-xs leading-relaxed text-text-secondary">
          <p><span className="font-semibold text-text-primary">{t("columns.score")}</span> — {t("guide.score")}</p>
          <p><span className="font-semibold text-text-primary">{t("columns.edge")}</span> — {t("guide.edge")}</p>
          <p>{t("guide.sorting")}</p>
          <p className="rounded-sm bg-bg-tertiary px-3 py-2">{t("guide.example")}</p>
        </div>
      </details>
```

用原生 `<details>`，不需要 `useState`，键盘可达性也自带。

**i18n**：三份文件都删掉 `screener.subtitle`，新增 `screener.guide` 这一组（`title` / `score` / `edge` / `sorting` / `example`）。

zh-CN：
```json
    "guide": {
      "title": "怎么看这个榜单？",
      "score": "这个币本身的质量，0–100 分。由市值（越小越高）、振幅、资金费率、持仓量、24h 涨跌、日内位置六个维度加权算出。",
      "edge": "这个币偏向哪一边、偏多少，等于「做多分 − 做空分」。数字越大，方向信号越明确。",
      "sorting": "榜单按「优势」排序，不按「评分」。因为六个维度里有一多半对做多和做空是一样的，只看评分的话两组会挑出几乎同一批币；看优势才知道它到底偏向哪边。",
      "example": "例：A 币做多 73 分、做空 71 分，优势只有 +2 —— 质量不错但方向不明朗；B 币做多 61 分、做空 39 分，优势 +22 —— 分数低一些，但明显偏多。榜单会把 B 排在 A 前面。"
    },
```

en-US：
```json
    "guide": {
      "title": "How do I read this board?",
      "score": "How good the coin is on its own, 0–100. Weighted across six dimensions: market cap (smaller scores higher), amplitude, funding rate, open interest, 24h change and intraday position.",
      "edge": "Which way the coin leans and by how much — it equals long score minus short score. The bigger the number, the clearer the directional signal.",
      "sorting": "The board is ranked by Edge, not by Score. More than half the six dimensions score the same for long and short, so ranking by Score alone would put nearly the same coins in both groups. Edge is what tells you which side a coin actually favours.",
      "example": "Example: coin A scores 73 long and 71 short — an edge of just +2, decent quality but no clear direction. Coin B scores 61 long and 39 short — an edge of +22, a lower score but a clear long lean. The board ranks B above A."
    },
```

ms-MY：
```json
    "guide": {
      "title": "Bagaimana membaca papan ini?",
      "score": "Kualiti syiling itu sendiri, 0–100. Ditimbang merentas enam dimensi: permodalan pasaran (lebih kecil lebih tinggi), amplitud, kadar pembiayaan, faedah terbuka, perubahan 24j dan kedudukan dalam julat harian.",
      "edge": "Arah kecenderungan syiling dan sebanyak mana — bersamaan skor beli tolak skor jual. Semakin besar nombornya, semakin jelas isyarat arahnya.",
      "sorting": "Papan ini disusun mengikut Kelebihan, bukan Skor. Lebih separuh daripada enam dimensi memberi skor sama untuk beli dan jual, jadi menyusun ikut Skor sahaja akan meletakkan syiling yang hampir sama dalam kedua-dua kumpulan. Kelebihan yang menunjukkan sebelah mana syiling itu benar-benar condong.",
      "example": "Contoh: syiling A dapat 73 beli dan 71 jual — kelebihan hanya +2, kualiti baik tetapi arah tidak jelas. Syiling B dapat 61 beli dan 39 jual — kelebihan +22, skor lebih rendah tetapi condong jelas ke beli. Papan meletakkan B di atas A."
    },
```

**验证**：起 dev server 打开 `/zh-CN/screener`，报告里写出：副标题已消失、说明面板能展开收起、两组仍各 10 条、**首屏加载时间**（应该从原来的几十秒降到一两秒）、控制台无报错。再用 `read_network_requests` 确认页面只打了 `/api/screener` 一个接口，不再有几十个 `openInterest` 请求。

---

## 自检

| 需求 | 对应任务 |
|---|---|
| 服务端算一次、全站共享 | Task 1（缓存）+ Task 2（流水线与路由） |
| 并发请求只触发一次计算 | Task 1 |
| 「立即刷新」不触发全站重算 | Task 3（只是重新 GET 缓存结果） |
| 打分算法不变 | 全程复用 `screener-scoring.ts`，禁止修改 |
| 去掉副标题 | Task 3 |
| 评分/优势说明面板 | Task 3 |
| 三语同步 | Task 3 |
