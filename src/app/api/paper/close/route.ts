import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperOrder } from "@/types";

/** 从 BingX 获取单个交易对的实时价格（直连，不依赖任何库函数） */
async function fetchBingXPrice(symbol: string): Promise<number> {
  const BINGX_BASE = process.env.NEXT_PUBLIC_BINGX_API_BASE_URL || "https://open-api.bingx.com";
  const url = `${BINGX_BASE}/openApi/spot/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-SOURCE-KEY": "BX-AI-SKILL",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BingX HTTP ${res.status}`);
  }

  const json = await res.json();
  const raw = json.data ?? json;
  const ticker = Array.isArray(raw) ? raw[0] : raw;
  const price = parseFloat(ticker?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid lastPrice: ${ticker?.lastPrice}`);
  }

  return price;
}

/** 精确全平指定 symbol 的模拟盘仓位（按持仓量平仓，避免名义值换算误差） */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { symbol } = body as { symbol?: string };
    if (!symbol) {
      return NextResponse.json({ success: false, error: { message: "Missing field: symbol" } }, { status: 400 });
    }

    let price: number;
    try {
      price = await fetchBingXPrice(symbol);
    } catch (priceErr) {
      return NextResponse.json({
        success: false,
        error: { message: `无法获取实时价格: ${String(priceErr)}` },
      }, { status: 502 });
    }

    const { data: order, error } = await supabase
      .rpc("close_paper_position", { p_symbol: symbol, p_price: price })
      .single<PaperOrder>();

    if (error) {
      const message =
        error.message.includes("position_not_found") ? "该交易对无持仓 / No open position"
        : error.message;
      return NextResponse.json({ success: false, error: { message } }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
