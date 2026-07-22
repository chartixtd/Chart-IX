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

    const data = await getSpotTicker(symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
