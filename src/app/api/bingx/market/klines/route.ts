import { NextRequest, NextResponse } from "next/server";
import { getSpotKlines, getFuturesKlines } from "@/lib/bingx/market";
import {
  checkMarketRateLimit, rateLimitedResponse,
  clampLimit, isValidSymbol, invalidSymbolResponse,
  isValidInterval, invalidIntervalResponse,
  withMarketCache,
} from "@/lib/bingx/market-guard";

export async function GET(request: NextRequest) {
  if (!checkMarketRateLimit(request)) return rateLimitedResponse();

  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const interval = searchParams.get("interval") || "1h";
    // BingX's own documented cap is 500/request; useKlineHistory pages at 300.
    const limit = clampLimit(searchParams.get("limit"), 100, 500);
    const market = searchParams.get("market") || "spot";
    const startTimeParam = searchParams.get("startTime");
    const endTimeParam = searchParams.get("endTime");
    const startTime = startTimeParam ? parseInt(startTimeParam) : undefined;
    const endTime = endTimeParam ? parseInt(endTimeParam) : undefined;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "symbol is required" } },
        { status: 400 }
      );
    }
    if (!isValidSymbol(symbol)) return invalidSymbolResponse();
    if (!isValidInterval(interval)) return invalidIntervalResponse();

    // Client polls every 10s for the live tail (see useKlines); history pages
    // are one-shot backfill requests so the short cache window doesn't hurt them.
    if (market === "futures") {
      const data = await getFuturesKlines(symbol, interval, limit, startTime, endTime);
      return withMarketCache({ success: true, data }, 5, 15);
    }

    const data = await getSpotKlines(symbol, interval, limit, startTime, endTime);
    return withMarketCache({ success: true, data }, 5, 15);
  } catch (error) {
    console.error("[bingx/market/klines]", error);
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: "Failed to fetch klines" } },
      { status: 502 }
    );
  }
}
