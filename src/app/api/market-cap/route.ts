import { NextResponse } from "next/server";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";

export async function GET() {
  try {
    const rows = await fetchMarketCapRows();
    return NextResponse.json({ success: true, data: rows });
  } catch {
    // 取数彻底失败，或名单缺了排名前列的头部（详见 fetchMarketCapRows）。
    // 前端据此把市值维度整体退化成中性分，而不是拿一份残缺名单继续算。
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MARKET_CAP_UNAVAILABLE",
          message: "CoinGecko market data unavailable or missing top ranks",
        },
      },
      { status: 502 }
    );
  }
}
