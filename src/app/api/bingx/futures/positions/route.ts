import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import {
  getFuturesPositions, closePosition, getFuturesBalance,
  getLeverage, setLeverage, getMarginType, setMarginType,
  getPositionSideDual, setPositionTpSl, closeAllPositions, adjustPositionMargin,
  placeFuturesOrder,
} from "@/lib/bingx/futures";
import { invalidateDualSideMode, getDualSideMode } from "@/lib/trading/account-mode";
import { describeBingXError } from "@/lib/trading/errors";
import { getSymbolSpec } from "@/lib/trading/spec";
import { formatQty, floorToPrecision } from "@/lib/trading/sizing";

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
    // 带上 BingX 错误码与 i18nKey：只回 String(error) 时前端和日志都看不出
    // 到底是签名、权限还是限流，排查只能靠猜（与 POST 分支保持一致）
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
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
    const {
      action, symbol, positionSide, positionId, leverage, marginType, stopLossPrice, takeProfitPrice,
      cancelTakeProfit, cancelStopLoss, amount, directionType, percent,
    } = body;

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
        case "reduceOnlyClose": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required" } },
              { status: 400 }
            );
          }
          const pct = Number(percent);
          if (!(pct > 0) || pct > 100) {
            return NextResponse.json(
              { success: false, error: { message: "percent must be between 0 and 100" } },
              { status: 400 }
            );
          }

          // 数量按服务端重新拉取的最新持仓量算，不信任客户端传来的任何数量——
          // 客户端只负责传一个百分比
          const positions = await getFuturesPositions(apiKey, secret, symbol);
          const pos = positions.find((p) => p.positionId === positionId);
          if (!pos) {
            return NextResponse.json(
              { success: false, error: { message: "Position not found" } },
              { status: 404 }
            );
          }
          if (pos.symbol !== symbol) {
            return NextResponse.json(
              { success: false, error: { message: "symbol does not match position" } },
              { status: 400 }
            );
          }

          // 100% 走整仓平仓的既有代码路径——按精度 floor 计算数量在 100% 场景下
          // 可能留下无法平掉的精度残余，closePosition 按 positionId 直接平仓，无需算量
          if (pct >= 100) {
            return NextResponse.json({
              success: true,
              data: await closePosition(apiKey, secret, positionId),
            });
          }

          const spec = await getSymbolSpec(symbol, "futures", pos.positionSide === "SHORT" ? "SHORT" : "LONG");
          if (!spec) {
            return NextResponse.json(
              { success: false, error: { message: "Symbol spec unavailable" } },
              { status: 502 }
            );
          }

          const fullQty = Math.abs(parseFloat(pos.positionAmt));
          const rawCloseQty = floorToPrecision((fullQty * pct) / 100, spec.quantityPrecision);
          const closeQty = formatQty(rawCloseQty, spec);
          if (!(parseFloat(closeQty) > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "Computed close quantity rounds to zero" } },
              { status: 400 }
            );
          }
          if (rawCloseQty < spec.minQty) {
            return NextResponse.json(
              { success: false, error: { message: `Computed close quantity is below the minimum order size (${spec.minQty})` } },
              { status: 400 }
            );
          }

          const closeSide = pos.positionSide === "LONG" ? "SELL" : "BUY";
          const dualSide = await getDualSideMode(authData.user.id, apiKey, secret);
          const result = await placeFuturesOrder(apiKey, secret, {
            symbol,
            side: closeSide,
            positionSide: dualSide ? pos.positionSide : "BOTH",
            type: "MARKET",
            quantity: closeQty,
            reduceOnly: true,
          });
          return NextResponse.json({ success: true, data: result });
        }
        case "reversePosition": {
          if (!positionId) {
            return NextResponse.json(
              { success: false, error: { message: "positionId is required" } },
              { status: 400 }
            );
          }

          const positions = await getFuturesPositions(apiKey, secret, symbol);
          const pos = positions.find((p) => p.positionId === positionId);
          if (!pos) {
            return NextResponse.json(
              { success: false, error: { message: "Position not found" } },
              { status: 404 }
            );
          }
          if (pos.symbol !== symbol) {
            return NextResponse.json(
              { success: false, error: { message: "symbol does not match position" } },
              { status: 400 }
            );
          }

          const qty = Math.abs(parseFloat(pos.positionAmt));
          if (!(qty > 0)) {
            return NextResponse.json(
              { success: false, error: { message: "Position has no open quantity" } },
              { status: 400 }
            );
          }

          // 反向开仓的数量必须在平仓之前就算好并校验——如果精度对齐后数量归零，
          // 必须在调用 closePosition 之前就拒绝，不能先平仓再发现开不了新仓
          const newPositionSide = pos.positionSide === "LONG" ? "SHORT" : "LONG";
          const openSide = newPositionSide === "LONG" ? "BUY" : "SELL";
          const reopenSpec = await getSymbolSpec(symbol, "futures", newPositionSide);
          if (!reopenSpec) {
            return NextResponse.json(
              { success: false, error: { message: "Symbol spec unavailable" } },
              { status: 502 }
            );
          }
          const rawReopenQty = floorToPrecision(qty, reopenSpec.quantityPrecision);
          const reopenQty = formatQty(rawReopenQty, reopenSpec);
          if (!(parseFloat(reopenQty) > 0) || rawReopenQty < reopenSpec.minQty) {
            return NextResponse.json(
              { success: false, error: { message: "Computed reopen quantity is below the minimum order size" } },
              { status: 400 }
            );
          }

          // 第一步：整仓平掉
          await closePosition(apiKey, secret, positionId);

          // 第二步：按原数量反向开仓。这一步如果失败必须显式告诉用户"已平仓但
          // 反向开仓失败"——不能让调用方以为整个操作都没发生
          try {
            const dualSide = await getDualSideMode(authData.user.id, apiKey, secret);
            const result = await placeFuturesOrder(apiKey, secret, {
              symbol,
              side: openSide,
              positionSide: dualSide ? newPositionSide : "BOTH",
              type: "MARKET",
              quantity: reopenQty,
              reduceOnly: false,
            });
            return NextResponse.json({ success: true, data: result });
          } catch (reopenError) {
            const described = describeBingXError(reopenError);
            return NextResponse.json(
              {
                success: false,
                error: {
                  message: `Position closed but failed to reopen in the opposite direction: ${described.rawMessage}`,
                  i18nKey: "trading.reverse_reopen_failed",
                  code: described.code,
                },
              },
              { status: 502 }
            );
          }
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
        case "setPositionTpSl": {
          // BingX 对冲模式下不接受 closePosition=true 免传 quantity 这个"标准
          // 用法"（实测仍拒单），必须显式带触发时要平掉的实际数量——因此这里
          // 总要先按最新持仓量现算 quantity，不信任客户端传来的任何数量
          // （与 reduceOnlyClose 的既有原则一致）。这次查询顺带把标记价也拿到
          // 了，直接用它做数量级合理性校验，不用再额外拿一次、也不用依赖
          // 客户端传的 markPrice——查不到持仓就直接拒绝（fail closed）。
          const positions = await getFuturesPositions(apiKey, secret, symbol);
          const pos = positions.find((p) => p.positionSide === (positionSide === "SHORT" ? "SHORT" : "LONG"));
          if (!pos) {
            return NextResponse.json(
              { success: false, error: { message: "Position not found" } },
              { status: 404 }
            );
          }

          const mark = parseFloat(pos.markPrice);
          if (Number.isFinite(mark) && mark > 0) {
            const isFarFromMark = (v: unknown) => {
              const n = Number(v);
              return Number.isFinite(n) && n > 0 && (n < mark * 0.2 || n > mark * 5);
            };
            if (isFarFromMark(takeProfitPrice) || isFarFromMark(stopLossPrice)) {
              return NextResponse.json(
                {
                  success: false,
                  error: {
                    message: `TP/SL price is too far from the mark price (${mark})`,
                    i18nKey: "trading.price_too_far_from_mark",
                    limit: mark.toFixed(4),
                  },
                },
                { status: 400 }
              );
            }
          }

          // 数量只在真的要挂新单时才需要——纯"取消止盈/止损"不下新单，不用现算数量
          let quantity: string | undefined;
          if (takeProfitPrice || stopLossPrice) {
            const spec = await getSymbolSpec(symbol, "futures", pos.positionSide === "SHORT" ? "SHORT" : "LONG");
            if (!spec) {
              return NextResponse.json(
                { success: false, error: { message: "Symbol spec unavailable" } },
                { status: 502 }
              );
            }
            const rawQty = floorToPrecision(Math.abs(parseFloat(pos.positionAmt)), spec.quantityPrecision);
            quantity = formatQty(rawQty, spec);
            if (!(parseFloat(quantity) > 0)) {
              return NextResponse.json(
                { success: false, error: { message: "Position has no open quantity" } },
                { status: 400 }
              );
            }
          }

          // 必须按账户实际持仓模式决定 positionSide：单向模式下传 LONG/SHORT
          // 会被 BingX 拒绝（109400），与下单路径用同一套判断
          const dualSide = await getDualSideMode(authData.user.id, apiKey, secret);
          await setPositionTpSl(apiKey, secret, {
            symbol, positionSide, stopLossPrice, takeProfitPrice, dualSide, quantity,
            cancelTakeProfit: Boolean(cancelTakeProfit), cancelStopLoss: Boolean(cancelStopLoss),
          });
          return NextResponse.json({ success: true });
        }
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
