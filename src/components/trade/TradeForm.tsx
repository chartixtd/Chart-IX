"use client";

import { useState } from "react";
import { useSpotTicker } from "@/hooks/useMarketData";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TradeFormProps {
  symbol: string;
}

type OrderType = "MARKET" | "LIMIT";
type OrderSide = "BUY" | "SELL";

export function TradeForm({ symbol }: TradeFormProps) {
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const [side, setSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const total = orderType === "LIMIT" && price
    ? (parseFloat(amount || "0") * parseFloat(price)).toFixed(2)
    : amount || "0";

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (orderType === "LIMIT" && (!price || parseFloat(price) <= 0)) return;

    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/bingx/trade/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          type: orderType,
          quantity: amount,
          ...(orderType === "LIMIT" && { price }),
        }),
      });

      const json = await res.json();

      if (json.success) {
        setResult({
          ok: true,
          message: `${side === "BUY" ? "Bought" : "Sold"} ${amount} ${symbol} · Order: ${json.data.orderId}`,
        });
        setAmount("");
        if (orderType === "LIMIT") setPrice("");
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
      {/* Side Toggle */}
      <div className="flex border-b border-border-default">
        <button
          onClick={() => setSide("BUY")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold transition-colors",
            side === "BUY"
              ? "bg-success/10 text-success border-b-2 border-success"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("SELL")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold transition-colors",
            side === "SELL"
              ? "bg-danger/10 text-danger border-b-2 border-danger"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          Sell
        </button>
      </div>

      <div className="flex-1 space-y-3 p-3">
        {/* Order Type */}
        <div className="flex gap-1">
          {(["MARKET", "LIMIT"] as OrderType[]).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={cn(
                "flex-1 rounded-xs py-1 text-xs font-medium transition-colors",
                orderType === t
                  ? "bg-bg-hover text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {t === "MARKET" ? "Market" : "Limit"}
            </button>
          ))}
        </div>

        {/* Limit Price */}
        {orderType === "LIMIT" && (
          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>Price</span>
              <span>≈ {formatPrice(currentPrice)}</span>
            </div>
            <Input
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="text-sm"
            />
          </div>
        )}

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{orderType === "MARKET" ? "Amount (USDT)" : "Quantity"}</span>
          </div>
          <Input
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-sm"
          />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Total</span>
          <span className="text-text-primary font-medium">
            {orderType === "MARKET" ? `${total} USDT` : `${total} USDT`}
          </span>
        </div>

        {/* Submit */}
        <Button
          className="w-full"
          variant={side === "BUY" ? "green" : "red"}
          loading={submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? "Placing..."
            : side === "BUY"
              ? `Buy ${symbol.split("-")[0]}`
              : `Sell ${symbol.split("-")[0]}`}
        </Button>

        {/* Result */}
        {result && (
          <div className={cn(
            "rounded-xs px-3 py-2 text-xs",
            result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
          )}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
