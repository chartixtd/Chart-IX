import { NextResponse } from "next/server";
import type { CoinGeckoMarketRow } from "@/lib/market-cap";
import { hasTopRankCoverage } from "@/lib/market-cap";

const COINGECKO_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const PAGES = [1, 2, 3, 4];
const PER_PAGE = 250;
const CACHE_SECONDS = 3600;
const PAGE_TIMEOUT_MS = 8000;
const RATE_LIMIT_RETRY_MS = 1500;

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

  const request = () =>
    fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
    });

  let res = await request();
  // CoinGecko 免密钥档限流很凶，四个并发请求正好踩在阈值上。等一小段再试一次就够——
  // 别做指数退避循环，外面还有 PAGE_TIMEOUT_MS 的等待上限。
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    res = await request();
  }
  if (!res.ok) throw new Error(`CoinGecko page ${page} failed: ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`CoinGecko page ${page} returned a non-array body`);
  return normalize(json);
}

/**
 * 只给等待设上限，不给 fetch 传 signal —— Next 15 的 fetch 被数据缓存包过一层，
 * 带 signal 有可能让这次请求绕开 revalidate 缓存，那样反而会把 CoinGecko 打爆。
 * 超时后这次 fetch 仍在后台跑完并写入缓存，正好给下一次请求预热。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`CoinGecko page timed out after ${ms}ms`)), ms);
  });
  // 成功路径也必须清掉定时器，否则每页都留一个最长 8s 的活定时器挂在事件循环上。
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function GET() {
  const settled = await Promise.allSettled(PAGES.map((page) => withTimeout(fetchPage(page), PAGE_TIMEOUT_MS)));

  const rows: CoinGeckoMarketRow[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") rows.push(...result.value);
  }

  // 第 1 页装着排名 1-250，正是市值排除规则要拦的那批。少了它，
  // 大币会变成"查不到市值"→ 不排除 + 满分，而且前端毫无察觉。
  // 宁可整体失败让前端走中性分兜底，也不能返回一份缺了头部的名单。
  if (rows.length === 0 || !hasTopRankCoverage(rows)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MARKET_CAP_UNAVAILABLE",
          message: "CoinGecko market data unavailable or missing top ranks",
        },
      },
      { status: 502 }
    );
  }

  rows.sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity));
  return NextResponse.json({ success: true, data: rows });
}
