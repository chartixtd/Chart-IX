import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTier } from "@/lib/supabase/get-user-tier";
import { canUseAdvancedChart } from "@/lib/access";
import { getExternalSeriesCached } from "@/lib/coinglass/chart-series-cache";
import { CoinGlassError } from "@/lib/coinglass/client";
import { parseExternalSeriesQuery } from "@/lib/chart/external-series";

/**
 * GET /api/coinglass/series?kind=oi|cvd&coin=BTC&interval=30m
 *     &market=spot|futures&margin=all|stablecoin|coin&unit=usd|coin&exchanges=Binance,OKX
 * 参数含义与校验见 external-series.ts 的 parseExternalSeriesQuery。
 *
 * K 线图上 CoinGlass 指标（聚合 OI / 聚合 CVD）的唯一数据入口。
 *
 * 门控到 Pro：图表上这两个指标本来就在 canUseAdvancedChart 门后，而且
 * 每次 miss 都真实消耗与选币器共用的 CoinGlass 配额——这个接口不能是一个
 * 对外开放的付费 API 代理。
 *
 * 响应不走 CDN 缓存（private）：新鲜度由服务端双层缓存 + 客户端 react-query
 * 的 staleTime 共同决定（同一个 TTL 常量），CDN 再夹一层只会让三处时钟打架。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail(401, "UNAUTHORIZED", "Login required");
  }
  if (!canUseAdvancedChart(await getUserTier(authData.user.id))) {
    return fail(403, "PRO_REQUIRED", "CoinGlass chart data requires a Pro subscription");
  }

  const { searchParams } = request.nextUrl;
  const parsed = parseExternalSeriesQuery((name) => searchParams.get(name));
  if (!parsed.ok) return fail(400, parsed.code, parsed.message);
  const req = parsed.request;

  try {
    const result = await getExternalSeriesCached(req);
    return NextResponse.json(
      {
        success: true,
        data: { request: req, bars: result.bars, fetchedAt: result.fetchedAt, stale: result.stale },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    // 真走到这里 = 上游失败且一根旧数据都没有。区分配额/套餐问题与其它错误，
    // 方便在日志里一眼看出是「被限流了」还是「端点/粒度不在套餐里」。
    const code = error instanceof CoinGlassError ? `COINGLASS_${error.code}` : "UPSTREAM_ERROR";
    console.error(`[coinglass/series] ${JSON.stringify(req)} failed`, error);
    return fail(503, code, "CoinGlass data is temporarily unavailable");
  }
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}
