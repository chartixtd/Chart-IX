import { NextRequest, NextResponse } from "next/server";
import { getFuturesFundingRate } from "@/lib/bingx/market";
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
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PARAM", message: "symbol is required" } },
        { status: 400 }
      );
    }
    if (!isValidSymbol(symbol)) return invalidSymbolResponse();

    const data = await getFuturesFundingRate(symbol);
    // Client polls every 60s (see useFundingRate).
    return withMarketCache({ success: true, data }, 30, 60);
  } catch (error) {
    console.error("[bingx/market/fundingRate]", error);
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: "Failed to fetch funding rate" } },
      { status: 502 }
    );
  }
}
