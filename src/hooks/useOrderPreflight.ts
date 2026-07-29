"use client";

import { useMemo } from "react";
import { quoteToBase, validateOrderSize, requiredMargin } from "@/lib/trading/sizing";
import type { SymbolSpec, OrderSizing, SizeValidation } from "@/types/trading";

interface PreflightArgs {
  spec: SymbolSpec | undefined;
  notionalUsdt: number;
  price: number;
  leverage: number;
  direction: "LONG" | "SHORT";
}

export interface OrderPreflightPreview {
  sizing: OrderSizing | null;
  validation: SizeValidation | null;
  requiredMarginUsdt: number;
  estFee: number;
  /** 逐仓近似强平价；仅作量级提示，交易所实际值以持仓面板为准 */
  estLiquidationPrice: number | null;
}

/**
 * 前端预览。复用服务端同一套 sizing 纯函数，
 * 因此这里显示的数量与服务端最终下单的数量一致。
 */
export function useOrderPreflight({
  spec, notionalUsdt, price, leverage, direction,
}: PreflightArgs): OrderPreflightPreview {
  return useMemo(() => {
    if (!spec || !(notionalUsdt > 0) || !(price > 0)) {
      return { sizing: null, validation: null, requiredMarginUsdt: 0, estFee: 0, estLiquidationPrice: null };
    }

    const sizing = quoteToBase(notionalUsdt, price, spec);
    const validation = validateOrderSize(sizing, spec);
    const margin = requiredMargin(sizing.notional, leverage);
    const estFee = sizing.notional * (spec.takerFeeRate ?? 0);

    // 逐仓近似：多头 P_liq ≈ P × (1 - 1/L)，空头 ≈ P × (1 + 1/L)。
    // 未计入维持保证金率与手续费，真实强平价由交易所给出，这里只用于量级提示。
    let estLiquidationPrice: number | null = null;
    if (spec.market === "futures" && leverage >= 1) {
      estLiquidationPrice =
        direction === "LONG" ? price * (1 - 1 / leverage) : price * (1 + 1 / leverage);
    }

    return { sizing, validation, requiredMarginUsdt: margin, estFee, estLiquidationPrice };
  }, [spec, notionalUsdt, price, leverage, direction]);
}
