import { NextRequest, NextResponse } from "next/server";
import { getSpotTicker, getSpotTickers, getFuturesTicker, getFuturesTickers } from "@/lib/bingx/market";
import {
  checkMarketRateLimit, rateLimitedResponse,
  isValidSymbol, invalidSymbolResponse,
  withMarketCache,
} from "@/lib/bingx/market-guard";

export async function GET(request: NextRequest) {
  if (!checkMarketRateLimit(request)) return rateLimitedResponse();

  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const market = searchParams.get("market") || "spot";

    // 批量获取 — polled every 30s (spot list) / SCREENER_REFRESH_MS (futures)
    if (!symbol) {
      const data = market === "futures" ? await getFuturesTickers() : await getSpotTickers();
      return withMarketCache({ success: true, data }, 5, 20);
    }

    if (!isValidSymbol(symbol)) return invalidSymbolResponse();

    // Single-symbol polls every 5s (see useSpotTicker/useFuturesTicker).
    if (market === "futures") {
      const data = await getFuturesTicker(symbol);
      return withMarketCache({ success: true, data }, 2, 8);
    }

    // getSpotTicker can return null: BingX returns the ticker wrapped in a
    // (possibly empty) array for single-symbol spot queries, and an unknown
    // symbol legitimately yields nothing to unwrap.
    const data = await getSpotTicker(symbol);
    if (!data) {
      return NextResponse.json(
        { success: false, error: { code: "TICKER_NOT_FOUND", message: `No ticker data for ${symbol}` } },
        { status: 404 }
      );
    }
    return withMarketCache({ success: true, data }, 2, 8);
  } catch (error) {
    console.error("[bingx/market/ticker]", error);
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: "Failed to fetch ticker" } },
      { status: 502 }
    );
  }
}
