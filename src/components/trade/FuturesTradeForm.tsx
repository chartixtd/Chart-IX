"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useSpotTicker } from "@/hooks/useMarketData";

interface FuturesTradeFormProps {
  symbol: string;
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];

export function FuturesTradeForm({ symbol }: FuturesTradeFormProps) {
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const [positionSide, setPositionSide] = useState<"LONG" | "SHORT">("LONG");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [leverage, setLeverage] = useState(10);
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [tpPrice, setTpPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Set leverage when changed
  useEffect(() => {
    if (!symbol || leverage <= 0) return;
    fetch("/api/bingx/futures/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setLeverage", symbol, leverage, positionSide }),
    }).catch(() => {});
  }, [symbol, leverage, positionSide]);

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (orderType === "LIMIT" && (!price || parseFloat(price) <= 0)) return;

    setSubmitting(true);
    setResult(null);

    try {
      const side = positionSide === "LONG" ? "BUY" : "SELL";
      const res = await fetch("/api/bingx/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol, side, positionSide, type: orderType, quantity: amount,
          ...(orderType === "LIMIT" && { price }),
          ...(slPrice && { stopLossPrice: slPrice }),
          ...(tpPrice && { takeProfitPrice: tpPrice }),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setResult({ ok: true, message: `${positionSide} ${amount} ${symbol} @ ${leverage}x · ${json.data.orderId}` });
        setAmount("");
        if (orderType === "LIMIT") setPrice("");
        setSlPrice(""); setTpPrice("");
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
    <div className="flex flex-col h-full">
      {/* Position Side */}
      <div className="flex border-b border-border-default">
        <button
          onClick={() => setPositionSide("LONG")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", positionSide === "LONG" ? "bg-success/10 text-success border-b-2 border-success" : "text-text-muted hover:text-text-secondary")}
        >
          Long
        </button>
        <button
          onClick={() => setPositionSide("SHORT")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", positionSide === "SHORT" ? "bg-danger/10 text-danger border-b-2 border-danger" : "text-text-muted hover:text-text-secondary")}
        >
          Short
        </button>
      </div>

      <div className="flex-1 space-y-3 p-3 overflow-auto">
        {/* Leverage */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Leverage</span>
            <span className={leverage > 10 ? "text-danger" : ""}>{leverage}x</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {LEVERAGE_OPTIONS.map((l) => (
              <button
                key={l}
                onClick={() => setLeverage(l)}
                className={cn(
                  "rounded-xs px-2 py-0.5 text-xs font-medium transition-colors",
                  leverage === l ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted hover:text-text-primary"
                )}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Order Type */}
        <div className="flex gap-1">
          {(["MARKET", "LIMIT"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={cn("flex-1 rounded-xs py-1 text-xs font-medium", orderType === t ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary")}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Price */}
        {orderType === "LIMIT" && (
          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>Price</span>
              <span>≈ {currentPrice.toFixed(2)}</span>
            </div>
            <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} className="text-sm" />
          </div>
        )}

        {/* Quantity */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>Qty (USDT)</span>
          </div>
          <Input placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-sm" />
        </div>

        {/* TP/SL (advanced) */}
        <details className="text-xs">
          <summary className="text-text-muted cursor-pointer hover:text-text-secondary">TP / SL</summary>
          <div className="mt-2 space-y-2">
            <div>
              <span className="text-text-muted">Take Profit</span>
              <Input placeholder="0.00" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} className="text-sm mt-1" />
            </div>
            <div>
              <span className="text-text-muted">Stop Loss</span>
              <Input placeholder="0.00" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className="text-sm mt-1" />
            </div>
          </div>
        </details>

        {/* Submit */}
        <Button
          className="w-full"
          variant={positionSide === "LONG" ? "green" : "red"}
          loading={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Placing..." : `${positionSide} ${symbol.split("-")[0]} ${leverage}x`}
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
