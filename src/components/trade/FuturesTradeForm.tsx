"use client";

import { useState, useEffect } from "react";
import { useSpotTicker } from "@/hooks/useMarketData";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

interface FuturesTradeFormProps {
  symbol: string;
}

type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP" | "TAKE_PROFIT_MARKET" | "TAKE_PROFIT" | "TRAILING_STOP_MARKET" | "TRAILING_TP_SL";

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 25, 33, 50, 75, 100, 125, 150, 200, 300];

const ORDER_TYPES: { key: OrderType; label: string; desc: string }[] = [
  { key: "MARKET", label: "Market", desc: "Fill immediately at best price" },
  { key: "LIMIT", label: "Limit", desc: "Fill at specified price or better" },
  { key: "STOP_MARKET", label: "Stop MKT", desc: "Market order when stop price is reached" },
  { key: "STOP", label: "Stop LMT", desc: "Limit order when stop price is reached" },
  { key: "TAKE_PROFIT_MARKET", label: "TP Market", desc: "Take profit at market when price reached" },
  { key: "TAKE_PROFIT", label: "TP Limit", desc: "Take profit with limit when price reached" },
  { key: "TRAILING_STOP_MARKET", label: "Trail Stop", desc: "Dynamic stop following price at callback rate" },
  { key: "TRAILING_TP_SL", label: "TP/SL Trail", desc: "Trailing TP/SL for existing position" },
];

export function FuturesTradeForm({ symbol }: FuturesTradeFormProps) {
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const [positionSide, setPositionSide] = useState<"LONG" | "SHORT">("LONG");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [leverage, setLeverage] = useState(10);
  const [customLeverage, setCustomLeverage] = useState("");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [callbackRate, setCallbackRate] = useState("1");
  const [amount, setAmount] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [tpPrice, setTpPrice] = useState("");
  const [usePositionTpSl, setUsePositionTpSl] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const actualLeverage = customLeverage ? parseInt(customLeverage) : leverage;

  const isStopType = orderType.startsWith("STOP") || orderType.startsWith("TAKE_PROFIT") || orderType === "TRAILING_TP_SL";
  const isLimitType = orderType === "LIMIT" || orderType === "STOP" || orderType === "TAKE_PROFIT";
  const isTrailingStop = orderType === "TRAILING_STOP_MARKET" || orderType === "TRAILING_TP_SL";

  useEffect(() => {
    if (!symbol || actualLeverage <= 0) return;
    fetch("/api/bingx/futures/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setLeverage", symbol, leverage: actualLeverage, positionSide }),
    }).catch(() => {});
  }, [symbol, actualLeverage, positionSide]);

  const handleSubmit = async () => {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) return;
    if (isLimitType && (!price || parseFloat(price) <= 0)) return;
    if (isStopType && (!stopPrice || parseFloat(stopPrice) <= 0)) return;
    if (isTrailingStop && (!callbackRate || parseFloat(callbackRate) <= 0)) return;

    setSubmitting(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        symbol, side: positionSide === "LONG" ? "BUY" : "SELL",
        positionSide, type: orderType, quantity: amount,
      };

      if (isLimitType) body.price = price;
      if (isStopType) body.stopPrice = stopPrice;
      if (isTrailingStop) body.callbackRate = parseFloat(callbackRate);

      // stopLoss/takeProfit as nested objects for MARKET/LIMIT orders
      if (usePositionTpSl && (slPrice || tpPrice) && (orderType === "MARKET" || orderType === "LIMIT")) {
        if (slPrice) body.stopLoss = JSON.stringify({ type: "STOP_MARKET", stopPrice: parseFloat(slPrice), workingType: "MARK_PRICE" });
        if (tpPrice) body.takeProfit = JSON.stringify({ type: "TAKE_PROFIT_MARKET", stopPrice: parseFloat(tpPrice), workingType: "MARK_PRICE" });
      }

      const res = await fetch("/api/bingx/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        // Set position TP/SL for non-MARKET/LIMIT orders or if not attached inline
        if (usePositionTpSl && (slPrice || tpPrice) && !(orderType === "MARKET" || orderType === "LIMIT")) {
          fetch("/api/bingx/futures/positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "setPositionTpSl", symbol, positionSide,
              stopLossPrice: slPrice || undefined,
              takeProfitPrice: tpPrice || undefined,
            }),
          }).catch(() => {});
        }

        setResult({ ok: true, message: `${positionSide} ${orderType} ${amount}x ${symbol} · ${json.data.orderId}` });
        setAmount(""); setPrice(""); setStopPrice("");
      } else {
        setResult({ ok: false, message: json.error?.message || "Order failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* LONG / SHORT */}
      <div className="flex border-b border-border-default">
        <button onClick={() => setPositionSide("LONG")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", positionSide === "LONG" ? "bg-success/10 text-success border-b-2 border-success" : "text-text-muted")}>Long</button>
        <button onClick={() => setPositionSide("SHORT")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", positionSide === "SHORT" ? "bg-danger/10 text-danger border-b-2 border-danger" : "text-text-muted")}>Short</button>
      </div>

      <div className="flex-1 space-y-2.5 p-3">
        {/* Leverage */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Leverage</span>
            <span className={actualLeverage > 20 ? "text-danger font-semibold" : ""}>{actualLeverage}x</span>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {LEVERAGE_OPTIONS.map((l) => (
              <button key={l} onClick={() => { setLeverage(l); setCustomLeverage(""); }}
                className={cn("rounded-xs py-0.5 text-xs font-medium", leverage === l && !customLeverage ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted")}
              >{l}x</button>
            ))}
          </div>
          <input
            type="number" min="1" max="300" placeholder="Custom"
            value={customLeverage}
            onChange={(e) => setCustomLeverage(e.target.value)}
            className="w-full rounded-xs bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-gold/30"
          />
        </div>

        {/* Order Type */}
        <div>
          <div className="text-xs text-text-muted mb-1">Type</div>
          <div className="grid grid-cols-2 gap-1">
            {ORDER_TYPES.map(({ key, label }) => (
              <button key={key} onClick={() => setOrderType(key)}
                className={cn("rounded-xs py-1 text-xs font-medium", orderType === key ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary")}
              >{label}</button>
            ))}
          </div>
          <p className="text-xs text-text-muted/60 mt-1">{ORDER_TYPES.find(t => t.key === orderType)?.desc}</p>
        </div>

        {/* Trailing Stop Callback Rate */}
        {isTrailingStop && (
          <div>
            <div className="text-xs text-text-muted mb-1">Callback Rate (%)</div>
            <Input placeholder="1" value={callbackRate} onChange={(e) => setCallbackRate(e.target.value)} className="text-sm" />
            <p className="text-xs text-text-muted/60 mt-0.5">Market order triggers when price retraces {callbackRate}% from peak</p>
          </div>
        )}

        {/* Price */}
        {(isLimitType || orderType === "MARKET") && (
          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>Price</span>
              <span>≈ {currentPrice.toFixed(2)}</span>
            </div>
            <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)}
              className="text-sm" disabled={!isLimitType} />
          </div>
        )}

        {/* Stop Price */}
        {isStopType && (
          <div>
            <div className="text-xs text-text-muted mb-1">Stop Price</div>
            <Input placeholder="0.00" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className="text-sm" />
          </div>
        )}

        {/* Quantity */}
        <div>
          <div className="text-xs text-text-muted mb-1">Qty (USDT)</div>
          <Input placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-sm" />
        </div>

        {/* Position TP/SL */}
        <div className="border-t border-border-default pt-2">
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer mb-2">
            <input type="checkbox" checked={usePositionTpSl} onChange={(e) => setUsePositionTpSl(e.target.checked)}
              className="rounded-xs" />
            Set position TP/SL
          </label>
          {usePositionTpSl && (
            <div className="space-y-2">
              <div>
                <div className="text-xs text-text-muted mb-1">Take Profit Price</div>
                <Input placeholder="0.00" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} className="text-sm" />
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Stop Loss Price</div>
                <Input placeholder="0.00" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className="text-sm" />
              </div>
            </div>
          )}
        </div>

        <Button className="w-full" variant={positionSide === "LONG" ? "green" : "red"} loading={submitting} onClick={handleSubmit}>
          {submitting ? "Placing..." : `${positionSide} ${symbol.split("-")[0]} ${actualLeverage}x`}
        </Button>

        {result && (
          <div className={cn("rounded-xs px-3 py-2 text-xs", result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
