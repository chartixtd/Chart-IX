import { NextRequest, NextResponse } from "next/server";
import { getSpotDepth } from "@/lib/bingx/market";
import {
  checkMarketRateLimit, rateLimitedResponse,
  clampLimit, isValidSymbol, invalidSymbolResponse,
  withMarketCache,
} from "@/lib/bingx/market-guard";

export async function GET(request: NextRequest) {
  if (!checkMarketRateLimit(request)) return rateLimitedResponse();

  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const limit = clampLimit(searchParams.get("limit"), 10, 100);

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "symbol is required" } },
        { status: 400 }
      );
    }
    if (!isValidSymbol(symbol)) return invalidSymbolResponse();

    const data = await getSpotDepth(symbol, limit);
    // Client polls every 2s (see useOrderBook) — a 1s CDN window still cuts
    // concurrent-viewer load meaningfully without staling the book.
    return withMarketCache({ success: true, data }, 1, 3);
  } catch (error) {
    console.error("[bingx/market/depth]", error);
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: "Failed to fetch order book" } },
      { status: 502 }
    );
  }
}
