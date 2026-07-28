import { NextRequest, NextResponse } from "next/server";
import { getSpotTicker, getSpotTickers, getFuturesTicker } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const market = searchParams.get("market") || "spot";

    // 批量获取
    if (!symbol) {
      const data = await getSpotTickers();
      return NextResponse.json({ success: true, data });
    }

    if (market === "futures") {
      const data = await getFuturesTicker(symbol);
      return NextResponse.json({ success: true, data });
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
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
