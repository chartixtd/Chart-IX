import { NextRequest, NextResponse } from "next/server";
import { getSpotKlines, getFuturesKlines } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    const interval = searchParams.get("interval") || "1h";
    const limit = parseInt(searchParams.get("limit") || "100");
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

    if (market === "futures") {
      const data = await getFuturesKlines(symbol, interval, limit, startTime, endTime);
      return NextResponse.json({ success: true, data });
    }

    const data = await getSpotKlines(symbol, interval, limit, startTime, endTime);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } },
      { status: 502 }
    );
  }
}
