import { NextRequest, NextResponse } from "next/server";
import { getSpotTrades } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const limit = parseInt(searchParams.get("limit") || "20");

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "symbol is required" } },
        { status: 400 }
      );
    }

    const data = await getSpotTrades(symbol, limit);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
