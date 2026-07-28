import { NextRequest, NextResponse } from "next/server";
import { getFuturesFundingRate } from "@/lib/bingx/market";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PARAM", message: "symbol is required" } },
        { status: 400 }
      );
    }
    const data = await getFuturesFundingRate(symbol);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "BINGX_API_ERROR", message: String(error) } }
    );
  }
}
