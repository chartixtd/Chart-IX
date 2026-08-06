import { NextRequest, NextResponse } from "next/server";
import { getSymbolSpec } from "@/lib/trading/spec";
import type { TradingMarket } from "@/types/trading";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const market = (searchParams.get("market") || "spot") as TradingMarket;
    const side = searchParams.get("side") === "SHORT" ? "SHORT" : "LONG";

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { message: "symbol is required" } },
        { status: 400 }
      );
    }
    if (market !== "spot" && market !== "futures") {
      return NextResponse.json(
        { success: false, error: { message: "market must be spot or futures" } },
        { status: 400 }
      );
    }

    const spec = await getSymbolSpec(symbol, market, side);
    if (!spec) {
      return NextResponse.json(
        { success: false, error: { message: `Unknown symbol: ${symbol}` } },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: spec });
  } catch (error) {
    console.error("[trading/spec]", error);
    return NextResponse.json(
      { success: false, error: { message: "Failed to load symbol spec" } },
      { status: 502 }
    );
  }
}
