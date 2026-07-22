import { NextRequest, NextResponse } from "next/server";
import { getSpotSymbols, getFuturesContracts } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol") || undefined;
    const market = searchParams.get("market") || "spot";

    if (market === "futures") {
      const data = await getFuturesContracts();
      return NextResponse.json({ success: true, data });
    }

    const data = await getSpotSymbols(symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
