import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PaperPosition } from "@/types";

/** 设置/清除模拟盘持仓的止盈止损价（拖动图表上的止盈止损线触发） */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: { message: "Malformed JSON body" } }, { status: 400 });
    }

    const { symbol, takeProfit, stopLoss, clearTakeProfit, clearStopLoss } = body as {
      symbol?: string;
      takeProfit?: number;
      stopLoss?: number;
      clearTakeProfit?: boolean;
      clearStopLoss?: boolean;
    };
    if (!symbol) {
      return NextResponse.json({ success: false, error: { message: "Missing field: symbol" } }, { status: 400 });
    }
    if (takeProfit !== undefined && !(Number(takeProfit) > 0)) {
      return NextResponse.json({ success: false, error: { message: "takeProfit must be positive" } }, { status: 400 });
    }
    if (stopLoss !== undefined && !(Number(stopLoss) > 0)) {
      return NextResponse.json({ success: false, error: { message: "stopLoss must be positive" } }, { status: 400 });
    }

    const { data: position, error } = await supabase
      .rpc("set_paper_position_tp_sl", {
        p_symbol: symbol,
        p_take_profit: takeProfit ?? null,
        p_stop_loss: stopLoss ?? null,
        p_clear_take_profit: !!clearTakeProfit,
        p_clear_stop_loss: !!clearStopLoss,
      })
      .single<PaperPosition>();

    if (error) {
      const message =
        error.message.includes("position_not_found") ? "该交易对无持仓 / No open position"
        : error.message.includes("account_not_found") ? "模拟盘账户不存在"
        : error.message;
      return NextResponse.json({ success: false, error: { message } }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: position });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 500 });
  }
}
