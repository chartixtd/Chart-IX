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

type OrderType = "MARKET" | "LIMIT" | "TAKE_STOP_MARKET" | "TAKE_STOP_LIMIT" | "TRIGGER_MARKET" | "TRIGGER_LIMIT" | "OCO";
type OrderSide = "BUY" | "SELL";
type TIF = "GTC" | "IOC" | "FOK" | "PostOnly";

const ORDER_TYPES: { key: OrderType; label: string; desc: string }[] = [
  { key: "MARKET", label: "Market", desc: "Fill immediately at best price" },
  { key: "LIMIT", label: "Limit", desc: "Specify price, fill when matched" },
  { key: "TAKE_STOP_MARKET", label: "Stop Market", desc: "Triggers market order at stop price" },
  { key: "TAKE_STOP_LIMIT", label: "Stop Limit", desc: "Triggers limit order at stop price" },
  { key: "TRIGGER_MARKET", label: "Trigger MKT", desc: "Triggers market order at trigger price" },
  { key: "TRIGGER_LIMIT", label: "Trigger LMT", desc: "Triggers limit order at trigger price" },
  { key: "OCO", label: "OCO", desc: "One Cancels Other (limit + stop)" },
];

const TIF_OPTIONS: TIF[] = ["GTC", "IOC", "FOK", "PostOnly"];

export function TradeForm({ symbol }: TradeFormProps) {
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const [side, setSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [tif, setTif] = useState<TIF>("GTC");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [ocoLimitPrice, setOcoLimitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isLimitType = orderType === "LIMIT" || orderType === "TAKE_STOP_LIMIT" || orderType === "TRIGGER_LIMIT";
  const isStopType = orderType.startsWith("TAKE_STOP") || orderType.startsWith("TRIGGER");
  const isOco = orderType === "OCO";

  const handlePercent = (pct: number) => {
    setPercent(pct);
    if (orderType === "MARKET") setAmount(String(pct));
    else setAmount(pct.toString());
  };

  const handleSubmit = async () => {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) return;
    if (isLimitType && (!price || parseFloat(price) <= 0)) return;
    if (isStopType && (!stopPrice || parseFloat(stopPrice) <= 0)) return;
    if (isOco && (!price || !stopPrice)) return;

    setSubmitting(true);
    setResult(null);

    try {
      let endpoint = "/api/bingx/trade/order";
      let body: Record<string, unknown>;

      if (isOco) {
        endpoint = "/api/bingx/trade/oco-order";
        body = {
          symbol, side, quantity: amount,
          limitPrice: price,
          triggerPrice: stopPrice,
          orderPrice: ocoLimitPrice || price,
        };
      } else if (orderType === "MARKET") {
        body = { symbol, side, type: orderType, quoteOrderQty: amount };
      } else {
        body = { symbol, side, type: orderType, quantity: amount };
        if (isLimitType) body = { ...body, price, timeInForce: tif };
        if (isStopType) body = { ...body, stopPrice };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        const id = json.data?.orderId || json.data?.orderListId || "";
        setResult({ ok: true, message: `${side} ${orderType} ${amount} ${symbol} · ${id}` });
        setAmount(""); setPrice(""); setStopPrice(""); setOcoLimitPrice(""); setPercent(0);
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
      {/* Side */}
      <div className="flex border-b border-border-default">
        <button
          onClick={() => setSide("BUY")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", side === "BUY" ? "bg-success/10 text-success border-b-2 border-success" : "text-text-muted hover:text-text-secondary")}
        >Buy</button>
        <button
          onClick={() => setSide("SELL")}
          className={cn("flex-1 py-2.5 text-sm font-semibold", side === "SELL" ? "bg-danger/10 text-danger border-b-2 border-danger" : "text-text-muted hover:text-text-secondary")}
        >Sell</button>
      </div>

      <div className="flex-1 space-y-2.5 p-3">
        {/* Order Type */}
        <div>
          <div className="text-xs text-text-muted mb-1">Type</div>
          <div className="grid grid-cols-2 gap-1">
            {ORDER_TYPES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setOrderType(key)}
                className={cn("rounded-xs py-1 text-xs font-medium", orderType === key ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary")}
              >{label}</button>
            ))}
          </div>
          <p className="text-xs text-text-muted/60 mt-1">{ORDER_TYPES.find(t => t.key === orderType)?.desc}</p>
        </div>

        {/* TIF */}
        {isLimitType && (
          <div className="flex gap-1">
            {TIF_OPTIONS.map((t) => (
              <button key={t} onClick={() => setTif(t)}
                className={cn("flex-1 rounded-xs py-0.5 text-xs", tif === t ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted")}
              >{t}</button>
            ))}
          </div>
        )}

        {/* Price */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{isOco ? "Limit Price" : "Price"}</span>
            <span>≈ {formatPrice(currentPrice)}</span>
          </div>
          <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)}
            className="text-sm" disabled={orderType === "MARKET"} />
        </div>

        {/* Stop Price */}
        {isStopType && (
          <div>
            <div className="text-xs text-text-muted mb-1">Stop Price</div>
            <Input placeholder="0.00" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className="text-sm" />
          </div>
        )}

        {/* OCO Stop Price + Limit */}
        {isOco && (
          <>
            <div>
              <div className="text-xs text-text-muted mb-1">Stop Price</div>
              <Input placeholder="0.00" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className="text-sm" />
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1">Stop Limit Price (optional)</div>
              <Input placeholder="0.00" value={ocoLimitPrice} onChange={(e) => setOcoLimitPrice(e.target.value)} className="text-sm" />
            </div>
          </>
        )}

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
            <span>{orderType === "MARKET" ? "Amount (USDT)" : "Quantity"}</span>
            <div className="flex gap-1">
              {[25, 50, 75, 100].map((p) => (
                <button key={p} onClick={() => handlePercent(p)}
                  className={cn("px-1 text-xs rounded-xs", percent === p ? "text-gold font-semibold" : "hover:text-text-primary")}
                >{p}%</button>
              ))}
            </div>
          </div>
          <Input placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setPercent(0); }}
            className="text-sm" />
        </div>

        <Button className="w-full" variant={side === "BUY" ? "green" : "red"} loading={submitting} onClick={handleSubmit}>
          {submitting ? "Placing..." : `${side} ${symbol.split("-")[0]}`}
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
