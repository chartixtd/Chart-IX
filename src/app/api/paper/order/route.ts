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

  // BingX wraps in { code: 0, data: ... }
  const data = json.data ?? json;
  const price = parseFloat(data.lastPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid lastPrice: ${data.lastPrice}`);
  }

  return price;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, side, quoteAmount, orderType, price: limitPrice } = body as {
      symbol?: string;
      side?: string;
      quoteAmount?: string | number;
      orderType?: string;
      price?: string | number;
    };

    if (!symbol || !side) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: symbol, side" } }, { status: 400 });
    }
    if (side !== "buy" && side !== "sell") {
      return NextResponse.json({ success: false, error: { message: "side must be buy or sell" } }, { status: 400 });
    }

    // 限价单分支
    if (orderType === "limit") {
      const priceNum = typeof limitPrice === "string" ? parseFloat(limitPrice) : (limitPrice as number);
      const qtyNum = typeof quoteAmount === "string" ? parseFloat(quoteAmount) : (quoteAmount as number);

      if (!priceNum || !Number.isFinite(priceNum) || priceNum <= 0) {
        return NextResponse.json({ success: false, error: { message: "price must be a positive number" } }, { status: 400 });
      }
      if (!qtyNum || !Number.isFinite(qtyNum) || qtyNum <= 0) {
        return NextResponse.json({ success: false, error: { message: "quantity must be a positive number" } }, { status: 400 });
      }

      const { data: order, error } = await supabase
        .rpc("place_paper_limit_order", {
          p_symbol: symbol,
          p_side: side,
          p_quantity: qtyNum,
          p_price: priceNum,
        })
        .single();

      if (error) {
        const message =
          error.message.includes("insufficient_balance") ? "余额不足 / Insufficient balance"
          : error.message.includes("insufficient_holding") ? "持仓不足 / Insufficient holding"
          : error.message;
        return NextResponse.json({ success: false, error: { message } }, { status: 400 });
      }

      return NextResponse.json({ success: true, data: order });
    }

    // 市价单分支
    if (!quoteAmount) {
      return NextResponse.json({ success: false, error: { message: "Missing fields: quoteAmount" } }, { status: 400 });
    }

    const amount = typeof quoteAmount === "string" ? parseFloat(quoteAmount) : quoteAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: { message: "quoteAmount must be a positive number" } }, { status: 400 });
    }

    // 直连 BingX 获取实时价格
    let price: number;
    try {
      price = await fetchBingXPrice(symbol);
    } catch (priceErr) {
      return NextResponse.json({
        success: false,
        error: { message: `无法获取实时价格: ${String(priceErr)}` },
      }, { status: 502 });
    }

    const quantity = amount / price;

    const { data: order, error } = await supabase
      .rpc("place_paper_order", {
        p_symbol: symbol,
        p_side: side,
        p_quantity: quantity,
        p_price: price,
      })
      .single<PaperOrder>();

    if (error) {
      const message =
        error.message.includes("insufficient_balance") ? "余额不足 / Insufficient balance"
        : error.message.includes("insufficient_holding") ? "持仓不足 / Insufficient holding"
        : error.message;
      return NextResponse.json({ success: false, error: { message } }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
