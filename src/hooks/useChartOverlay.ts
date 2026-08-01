"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePaperAccount, usePaperOrders } from "@/hooks/usePaperTrading";
import { useMarketStore } from "@/stores/market";
import { useToast } from "@/components/ui/Toast";
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
function classifyFuturesStop(type: string): "tp" | "sl" | null {
  const t = type.toUpperCase();
  if (t.includes("TAKE_PROFIT")) return "tp";
  if (t.includes("STOP")) return "sl";
  return null;
}

async function postJson(url: string, body: unknown): Promise<{ success: boolean; error?: { message: string } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * 聚合当前交易对的图表叠加数据（进出场标记 + 止盈止损/进场/强平价格线）。
 * 依据 market 选择数据源：模拟盘、实盘现货、实盘期货。止盈止损线带
 * `editable`，KlineChart 会渲染成可拖动的线，拖完调用这里定义的回调落地修改。
 */
export function useChartOverlay(symbol: string, market: TradeMarketType): Overlay {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
        positions: p.success && Array.isArray(p.data) ? p.data : [],
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
        trades: tj.success && Array.isArray(tj.data) ? tj.data : [],
        orders: oj.success ? (Array.isArray(oj.data) ? oj.data : oj.data?.orders ?? []) : [],
      };
    },
    enabled: market === "spot" && !!symbol,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  return useMemo<Overlay>(() => {
    const onDragSuccess = (queryKey: unknown[]) => queryClient.invalidateQueries({ queryKey });
    const onDragError = (message: string) => toast(`修改止盈止损失败：${message}`, "error");

    if (market === "paper") {
      return buildPaper(symbol, paperAcct, paperOrders, () =>
        queryClient.invalidateQueries({ queryKey: ["paper", "account"] })
      , onDragError);
    }
    if (market === "futures") {
      return buildFutures(symbol, futuresData, () => onDragSuccess(["overlay", "futures", symbol]), onDragError);
    }
    if (market === "spot") {
      return buildSpot(symbol, spotData, () => onDragSuccess(["overlay", "spot", symbol]), onDragError);
    }
    return EMPTY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, symbol, paperAcct, paperOrders, futuresData, spotData, queryClient]);
}

// ==================== builders ====================

/** 模拟盘：成交历史 → 进出场箭头；持仓 → 进场价/强平价/止盈止损线（止盈止损可拖动） */
function buildPaper(
  symbol: string,
  acct: {
    positions: Array<{
      symbol: string; side: string; entry_price: number; liquidation_price: number;
      leverage: number; take_profit_price: number | null; stop_loss_price: number | null;
    }>;
  } | undefined,
  orders: Array<{ symbol: string; side: string; price: number; quantity: number; created_at: string; reduce_only?: boolean }> | undefined,
  onDragSuccess: () => void,
  onDragError: (message: string) => void,
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
    const label = pos.side === "long" ? "多" : "空";
    if (pos.entry_price > 0) {
      priceLines.push({ price: pos.entry_price, color: ENTRY_COLOR, title: `进场 ${label} ${pos.leverage}x` });
    }
    if (pos.liquidation_price > 0) {
      priceLines.push({ price: pos.liquidation_price, color: LIQ_COLOR, title: "强平", dashed: true });
    }

    const setTpSl = async (patch: { takeProfit?: number; stopLoss?: number }) => {
      const result = await postJson("/api/paper/positions/tp-sl", { symbol, ...patch });
      if (!result.success) onDragError(result.error?.message ?? "未知错误");
      else onDragSuccess();
    };

    // 只在真的设置了止盈/止损时才画线——之前没设置也会画一条"建议线"（进场价
    // ±3% 处），用户反馈这是条"虚拟"的线，容易被误认成已经生效的止盈止损。
    if (pos.take_profit_price != null) {
      priceLines.push({
        price: pos.take_profit_price,
        color: TP_COLOR,
        title: "止盈",
        dashed: true,
        editable: { kind: "tp", onDragEnd: (price) => setTpSl({ takeProfit: price }) },
      });
    }
    if (pos.stop_loss_price != null) {
      priceLines.push({
        price: pos.stop_loss_price,
        color: SL_COLOR,
        title: "止损",
        dashed: true,
        editable: { kind: "sl", onDragEnd: (price) => setTpSl({ stopLoss: price }) },
      });
    }
  }

  return { tradeMarkers, priceLines };
}

/**
 * 实盘期货：持仓 → 进场价/强平价线；挂单 → 止盈/止损（可拖动）/限价线。
 * 如果这笔持仓当下完全没有挂止盈/止损单，额外画一条半透明的"建议线"（拖动即
 * 创建），否则用户开仓时没顺手带止盈止损，之后就再也没有入口能补设置——之前
 * 只在已有挂单时才显示线，这正是反馈的"下单后无法修改止盈止损"的根因。
 */
function buildFutures(
  symbol: string,
  data: { positions: Array<Record<string, unknown>>; orders: Array<Record<string, unknown>> } | undefined,
  onDragSuccess: () => void,
  onDragError: (message: string) => void,
): Overlay {
  if (!data) return EMPTY;
  const priceLines: ChartPriceLine[] = [];

  const position = data.positions.find((p) => String(p.symbol ?? "") === symbol);
  if (position) {
    // BingX's real field name here is avgPrice, not entryPrice — the position
    // panel elsewhere in the app has the same mismatch (fixed alongside this).
    const entry = parseFloat(String(position.avgPrice ?? ""));
    const liq = parseFloat(String(position.liquidationPrice ?? ""));
    const side = String(position.positionSide ?? "");
    const lev = position.leverage ?? "";
    if (isFinite(entry) && entry > 0) {
      priceLines.push({ price: entry, color: ENTRY_COLOR, title: `进场 ${side === "LONG" ? "多" : "空"} ${lev}x` });
    }
    if (isFinite(liq) && liq > 0) {
      priceLines.push({ price: liq, color: LIQ_COLOR, title: "强平", dashed: true });
    }
  }

  const amend = async (orderId: string, newPrice: number) => {
    const result = await postJson("/api/bingx/futures/order/amend", { symbol, orderId, stopPrice: newPrice });
    if (!result.success) onDragError(result.error?.message ?? "未知错误");
    else onDragSuccess();
  };

  for (const o of data.orders) {
    const type = String(o.type ?? "");
    const stop = parseFloat(String(o.stopPrice ?? ""));
    const price = parseFloat(String(o.price ?? ""));
    const kind = classifyFuturesStop(type);
    const orderId = String(o.orderId ?? "");
    if (kind === "tp" && isFinite(stop) && stop > 0) {
      priceLines.push({
        price: stop, color: TP_COLOR, title: "止盈", dashed: true,
        editable: orderId ? { kind: "tp", onDragEnd: (p) => amend(orderId, p) } : undefined,
      });
    } else if (kind === "sl" && isFinite(stop) && stop > 0) {
      priceLines.push({
        price: stop, color: SL_COLOR, title: "止损", dashed: true,
        editable: orderId ? { kind: "sl", onDragEnd: (p) => amend(orderId, p) } : undefined,
      });
    } else if (type.toUpperCase() === "LIMIT" && isFinite(price) && price > 0) {
      priceLines.push({ price, color: LIMIT_COLOR, title: `挂单 ${String(o.side ?? "")}`, dashed: true });
    }
  }

  return { tradeMarkers: [], priceLines };
}

/**
 * 现货没有"仓位"概念，止盈/止损都是挂在钱包余额上的条件卖单——用触发价相对
 * 当前市价的位置区分：SELL 且触发价高于现价＝止盈，低于现价＝止损。BUY 方向
 * 的条件单极少用来做止盈止损（现货难以做空），不猜测，按普通条件单处理。
 */
function classifySpotStop(side: string, stopPrice: number, marketPrice: number | undefined): "tp" | "sl" | null {
  if (side.toUpperCase() !== "SELL" || !marketPrice || !isFinite(marketPrice)) return null;
  return stopPrice >= marketPrice ? "tp" : "sl";
}

/** 实盘现货：成交记录 → 进出场箭头；条件单 → 止盈/止损（可拖动）；限价单 → 挂单线 */
function buildSpot(
  symbol: string,
  data: { trades: Array<Record<string, unknown>>; orders: Array<Record<string, unknown>> } | undefined,
  onDragSuccess: () => void,
  onDragError: (message: string) => void,
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

  const marketPrice = Number(useMarketStore.getState().tickers[symbol]?.lastPrice);

  const amend = async (o: Record<string, unknown>, newPrice: number) => {
    const orderId = String(o.orderId ?? "");
    const isLimitStyle = String(o.type ?? "").toUpperCase().includes("LIMIT");
    const result = await postJson("/api/bingx/trade/order/amend", {
      symbol,
      side: o.side,
      type: o.type,
      quantity: String(o.origQty ?? ""),
      price: isLimitStyle ? String(o.price ?? "") : undefined,
      stopPrice: newPrice,
      cancelOrderId: orderId,
    });
    if (!result.success) onDragError(result.error?.message ?? "未知错误");
    else onDragSuccess();
  };

  const priceLines: ChartPriceLine[] = [];
  for (const o of data.orders) {
    const type = String(o.type ?? "").toUpperCase();
    const price = parseFloat(String(o.price ?? ""));
    const stop = parseFloat(String(o.stopPrice ?? ""));

    if (type === "LIMIT" && isFinite(price) && price > 0) {
      priceLines.push({ price, color: LIMIT_COLOR, title: `挂单 ${String(o.side ?? "")}`, dashed: true });
      continue;
    }

    if (isFinite(stop) && stop > 0) {
      const kind = classifySpotStop(String(o.side ?? ""), stop, marketPrice);
      if (kind === "tp") {
        priceLines.push({
          price: stop, color: TP_COLOR, title: "止盈", dashed: true,
          editable: { kind: "tp", onDragEnd: (p) => amend(o, p) },
        });
      } else if (kind === "sl") {
        priceLines.push({
          price: stop, color: SL_COLOR, title: "止损", dashed: true,
          editable: { kind: "sl", onDragEnd: (p) => amend(o, p) },
        });
      } else {
        priceLines.push({ price: stop, color: LIMIT_COLOR, title: `条件单 ${String(o.side ?? "")}`, dashed: true });
      }
    }
  }

  return { tradeMarkers, priceLines };
}
