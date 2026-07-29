import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import {
  getFuturesPositions, closePosition, getFuturesBalance,
  getLeverage, setLeverage, getMarginType, setMarginType,
  getPositionSideDual, setPositionTpSl, closeAllPositions, adjustPositionMargin,
} from "@/lib/bingx/futures";
import { invalidateDualSideMode } from "@/lib/trading/account-mode";
import { describeBingXError } from "@/lib/trading/errors";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const { searchParams } = request.nextUrl;
    const type = searchParams.get("type") || "positions";
    const symbol = searchParams.get("symbol") || undefined;

    if (type === "balance") {
      const balance = await getFuturesBalance(apiKey, secret);
      return NextResponse.json({ success: true, data: balance });
    }

    if (type === "accountMode") {
      const mode = await getPositionSideDual(apiKey, secret);
      return NextResponse.json({
        success: true,
        data: { dualSidePosition: mode?.dualSidePosition === true },
      });
    }

    if (type === "leverage") {
      if (!symbol) {
        return NextResponse.json(
          { success: false, error: { message: "symbol is required" } },
          { status: 400 }
        );
      }
      // BingX 的查询接口按多空分开返回杠杆，客户端传方向来选对应的一侧；
      // 缺省当 LONG 处理（对单向持仓账户，long/short 字段实际是同一个值）
      const side = searchParams.get("side") === "SHORT" ? "SHORT" : "LONG";
      const [lev, margin] = await Promise.all([
        getLeverage(apiKey, secret, symbol),
        getMarginType(apiKey, secret, symbol).catch(() => ({ marginType: "" })),
      ]);
      const leverage = side === "SHORT" ? lev.shortLeverage : lev.longLeverage;
      const maxLeverage = side === "SHORT" ? lev.maxShortLeverage : lev.maxLongLeverage;
      return NextResponse.json({
        success: true,
        data: { leverage, maxLeverage, marginType: margin.marginType },
      });
    }

    return NextResponse.json({ success: true, data: await getFuturesPositions(apiKey, secret, symbol) });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    // Tier check: futures management requires pro
    const { data: profile } = await supabase
      .from("users")
      .select("tier")
      .eq("id", authData.user.id)
      .single();

    if (!profile || profile.tier !== "pro") {
      return NextResponse.json({ success: false, error: { message: "Futures trading requires Pro subscription" } }, { status: 403 });
    }

    const { data: apiKeys, error: keyError } = await supabase
      .from("api_keys").select("api_key_encrypted, secret_encrypted")
      .eq("user_id", authData.user.id).eq("is_valid", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
      .limit(1);

    if (keyError || !apiKeys?.length) {
      return NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 });
    }

    const apiKey = decrypt(apiKeys[0].api_key_encrypted);
    const secret = decrypt(apiKeys[0].secret_encrypted);

    const body = await request.json();
    const { action, symbol, positionSide, positionId, leverage, marginType, stopLossPrice, takeProfitPrice, amount, directionType } = body;

    try {
      switch (action) {
        case "closePosition": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required to close a position" } },
              { status: 400 }
            );
          }
          return NextResponse.json({
            success: true,
            data: await closePosition(apiKey, secret, positionId),
          });
        }
        case "closeAllPositions":
          return NextResponse.json({ success: true, data: await closeAllPositions(apiKey, secret, symbol) });
        case "setLeverage": {
          const lev = Number(leverage);
          if (!(lev > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "leverage must be positive" } },
              { status: 400 }
            );
          }
          await setLeverage(apiKey, secret, symbol, Math.floor(lev), positionSide);
          // 回读交易所实际值，前端据此显示而非乐观假设；GET 查询接口按多空分开返回，
          // 用刚才设置的方向选对应字段（positionSide 为 BOTH 时视为 LONG，单向持仓下
          // long/short 字段本就是同一个值）
          const applied = await getLeverage(apiKey, secret, symbol);
          const appliedLeverage = positionSide === "SHORT" ? applied.shortLeverage : applied.longLeverage;
          const appliedMaxLeverage = positionSide === "SHORT" ? applied.maxShortLeverage : applied.maxLongLeverage;
          return NextResponse.json({
            success: true,
            data: { leverage: appliedLeverage, maxLeverage: appliedMaxLeverage },
          });
        }
        case "setMarginType": {
          if (marginType !== "ISOLATED" && marginType !== "CROSSED") {
            return NextResponse.json(
              { success: false, error: { message: "marginType must be ISOLATED or CROSSED" } },
              { status: 400 }
            );
          }
          await setMarginType(apiKey, secret, symbol, marginType);
          // 回读交易所实际值，前端据此显示而非乐观假设（与 setLeverage 保持一致）
          const applied = await getMarginType(apiKey, secret, symbol);
          return NextResponse.json({ success: true, data: { marginType: applied.marginType } });
        }
        case "setPositionTpSl":
          await setPositionTpSl(apiKey, secret, { symbol, positionSide, stopLossPrice, takeProfitPrice });
          return NextResponse.json({ success: true });
        case "setPositionMode": {
          invalidateDualSideMode(authData.user.id);
          return NextResponse.json({ success: true });
        }
        case "adjustMargin":
          return NextResponse.json({
            success: true,
            data: await adjustPositionMargin(apiKey, secret, symbol, positionId, String(amount), directionType || 1),
          });
      }
      return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
    } catch (e) {
      const described = describeBingXError(e);
      return NextResponse.json(
        { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
