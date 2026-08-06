import { NextRequest, NextResponse } from "next/server";
import { getSpotSymbols, getFuturesContracts } from "@/lib/bingx/market";
import {
  checkMarketRateLimit, rateLimitedResponse,
  isValidSymbol, invalidSymbolResponse,
  withMarketCache,
} from "@/lib/bingx/market-guard";

export async function GET(request: NextRequest) {
  if (!checkMarketRateLimit(request)) return rateLimitedResponse();

  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;
    const market = searchParams.get("market") || "spot";

    if (symbol && !isValidSymbol(symbol)) return invalidSymbolResponse();

    // Symbol list changes at most a few times a day — safe to cache for a while.
    if (market === "futures") {
      const data = await getFuturesContracts();
      return withMarketCache({ success: true, data }, 60, 300);
    }

    const data = await getSpotSymbols(symbol);
    return withMarketCache({ success: true, data }, 60, 300);
  } catch (error) {
    console.error("[bingx/market/symbols]", error);
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: "Failed to fetch symbols" } },
      { status: 502 }
    );
  }
}
