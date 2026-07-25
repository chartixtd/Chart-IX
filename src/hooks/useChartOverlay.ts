"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePaperAccount, usePaperOrders } from "@/hooks/usePaperTrading";
import type { ChartTradeMarker, ChartPriceLine } from "@/components/trade/KlineChart";
import type { TradeMarketType } from "@/stores/tradePrefs";

// 价格线配色
const ENTRY_COLOR = "#3b82f6"; // 进场价 蓝
const LIQ_COLOR = "#f59e0b"; // 强平价 橙
const TP_COLOR = "#22c55e"; // 止盈 绿
const SL_COLOR = "#ef4444"; // 止损 红
const LIMIT_COLOR = "#a78bfa"; // 挂单 紫

interface Overlay {
  tradeMarkers: ChartTradeMarker[];
  priceLines: ChartPriceLine[];
}

const EMPTY: Overlay = { tradeMarkers: [], priceLines: [] };

/** 判断实盘期货挂单是否为止盈/止损类型 */
function classifyStop(type: string): "tp" | "sl" | null {
  const t = type.toUpperCase();
  if (t.includes("TAKE_PROFIT")) return "tp";
  if (t.includes("STOP")) return "sl";
  return null;
}

/**
 * 聚合当前交易对的图表叠加数据（进出场标记 + 止盈止损/进场/强平价格线）。
 * 依据 market 选择数据源：模拟盘、实盘现货、实盘期货。
 */
export function useChartOverlay(symbol: string, market: TradeMarketType): Overlay {
  // ---- 模拟盘 ----
  const { data: paperAcct } = usePaperAccount(market === "paper");
  const { data: paperOrders } = usePaperOrders(symbol, market === "paper");

  // ---- 实盘期货 ----
  const { data: futuresData } = useQuery({
    queryKey: ["overlay", "futures", symbol],
    queryFn: async () => {
      const [posRes, ordRes] = await Promise.all([
        fetch(`/api/bingx/futures/positions?symbol=${symbol}`),
        fetch(`/api/bingx/futures/open-orders?symbol=${symbol}`),
      ]);
      const p = await posRes.json();
      const o = await ordRes.json();
      return {
        positions: p.success ? (p.data ?? []) : [],
        orders: o.success ? (Array.isArray(o.data) ? o.data : o.data?.orders ?? []) : [],
      };
    },
    enabled: market === "futures" && !!symbol,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  // ---- 实盘现货 ----
  const { data: spotData } = useQuery({
    queryKey: ["overlay", "spot", symbol],
    queryFn: async () => {
      const [tradesRes, ordRes] = await Promise.all([
        fetch(`/api/bingx/trade/my-trades?symbol=${symbol}&limit=50`),
        fetch(`/api/bingx/trade/open-orders?symbol=${symbol}`),
      ]);
      const tj = await tradesRes.json();
      const oj = await ordRes.json();
      return {
        trades: tj.success ? (tj.data ?? []) : [],
        orders: oj.success ? (Array.isArray(oj.data) ? oj.data : oj.data?.orders ?? []) : [],
      };
    },
    enabled: market === "spot" && !!symbol,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  return useMemo<Overlay>(() => {
    if (market === "paper") return buildPaper(symbol, paperAcct, paperOrders);
    if (market === "futures") return buildFutures(futuresData);
    if (market === "spot") return buildSpot(spotData);
    return EMPTY;
  }, [market, symbol, paperAcct, paperOrders, futuresData, spotData]);
}

// ==================== builders ====================

/** 模拟盘：成交历史 → 进出场箭头；持仓 → 进场价/强平价线 */
function buildPaper(
  symbol: string,
  acct: { positions: Array<{ symbol: string; side: string; entry_price: number; liquidation_price: number; leverage: number }> } | undefined,
  orders: Array<{ symbol: string; side: string; price: number; quantity: number; created_at: string; reduce_only?: boolean }> | undefined,
): Overlay {
  const tradeMarkers: ChartTradeMarker[] = (orders ?? [])
    .filter((o) => o.symbol === symbol)
    .map((o) => ({
      time: new Date(o.created_at).getTime(),
      side: o.side === "buy" ? "buy" : "sell",
      text: `${o.reduce_only ? "平" : "开"}${o.side === "buy" ? "多" : "空"} ${o.price}`,
    }));

  const priceLines: ChartPriceLine[] = [];
  const pos = (acct?.positions ?? []).find((p) => p.symbol === symbol);
  if (pos) {
    if (pos.entry_price > 0) {
      priceLines.push({ price: pos.entry_price, color: ENTRY_COLOR, title: `进场 ${pos.side === "long" ? "多" : "空"} ${pos.leverage}x` });
    }
    if (pos.liquidation_price > 0) {
      priceLines.push({ price: pos.liquidation_price, color: LIQ_COLOR, title: "强平", dashed: true });
    }
  }

  return { tradeMarkers, priceLines };
}

/** 实盘期货：持仓 → 进场价/强平价线；挂单 → 止盈/止损/限价线 */
function buildFutures(
  data: { positions: Array<Record<string, unknown>>; orders: Array<Record<string, unknown>> } | undefined,
): Overlay {
  if (!data) return EMPTY;
  const priceLines: ChartPriceLine[] = [];

  for (const p of data.positions) {
    const entry = parseFloat(String(p.entryPrice ?? ""));
    const liq = parseFloat(String(p.liquidationPrice ?? ""));
    const side = String(p.positionSide ?? "");
    const lev = p.leverage ?? "";
    if (isFinite(entry) && entry > 0) {
      priceLines.push({ price: entry, color: ENTRY_COLOR, title: `进场 ${side === "LONG" ? "多" : "空"} ${lev}x` });
    }
    if (isFinite(liq) && liq > 0) {
      priceLines.push({ price: liq, color: LIQ_COLOR, title: "强平", dashed: true });
    }
  }

  for (const o of data.orders) {
    const type = String(o.type ?? "");
    const stop = parseFloat(String(o.stopPrice ?? ""));
    const price = parseFloat(String(o.price ?? ""));
    const kind = classifyStop(type);
    if (kind === "tp" && isFinite(stop) && stop > 0) {
      priceLines.push({ price: stop, color: TP_COLOR, title: "止盈", dashed: true });
    } else if (kind === "sl" && isFinite(stop) && stop > 0) {
      priceLines.push({ price: stop, color: SL_COLOR, title: "止损", dashed: true });
    } else if (type.toUpperCase() === "LIMIT" && isFinite(price) && price > 0) {
      priceLines.push({ price, color: LIMIT_COLOR, title: `挂单 ${String(o.side ?? "")}`, dashed: true });
    }
  }

  return { tradeMarkers: [], priceLines };
}

/** 实盘现货：成交记录 → 进出场箭头；挂单 → 限价线 */
function buildSpot(
  data: { trades: Array<Record<string, unknown>>; orders: Array<Record<string, unknown>> } | undefined,
): Overlay {
  if (!data) return EMPTY;

  const tradeMarkers: ChartTradeMarker[] = data.trades.map((t) => {
    const isBuyer = !!t.isBuyer;
    const price = parseFloat(String(t.price ?? ""));
    return {
      time: Number(t.time ?? 0),
      side: isBuyer ? "buy" : "sell",
      text: `${isBuyer ? "买" : "卖"} ${isFinite(price) ? price : ""}`,
    };
  });

  const priceLines: ChartPriceLine[] = [];
  for (const o of data.orders) {
    const type = String(o.type ?? "").toUpperCase();
    const price = parseFloat(String(o.price ?? ""));
    if (type === "LIMIT" && isFinite(price) && price > 0) {
      priceLines.push({ price, color: LIMIT_COLOR, title: `挂单 ${String(o.side ?? "")}`, dashed: true });
    }
  }

  return { tradeMarkers, priceLines };
}

