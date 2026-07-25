"use client";

import { useState, useMemo } from "react";
import { useSpotTicker } from "@/hooks/useMarketData";
import { usePaperAccount, usePlacePaperOrder } from "@/hooks/usePaperTrading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderConfirmModal } from "@/components/trade/OrderConfirmModal";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TradeFormProps {
  symbol: string;
  /** "live" places real BingX orders, "paper" uses the risk-free simulator */
  mode?: "live" | "paper";
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

const SIMPLE_ORDER_TYPES = ORDER_TYPES.filter((t) => t.key === "MARKET" || t.key === "LIMIT");
const PAPER_ORDER_TYPES = ORDER_TYPES.filter((t) => t.key === "MARKET" || t.key === "LIMIT");
const TIF_OPTIONS: TIF[] = ["GTC", "IOC", "FOK", "PostOnly"];

export function TradeForm({ symbol, mode = "live" }: TradeFormProps) {
  const isPaper = mode === "paper";
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

  const { data: paperData } = usePaperAccount(isPaper);
  const placePaperOrder = usePlacePaperOrder();

  // 当前交易对的模拟持仓
  const paperHolding = isPaper
    ? paperData?.holdings?.find((h) => h.symbol === symbol)
    : null;
  const holdingQty = paperHolding ? parseFloat(String(paperHolding.quantity)) : 0;

  const [uiMode, setUiMode] = useState<"simple" | "pro">("simple");
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const effectiveOrderType = isPaper
    ? (orderType === "MARKET" || orderType === "LIMIT" ? orderType : "MARKET")
    : orderType;
  const visibleOrderTypes = isPaper
    ? (uiMode === "simple" ? SIMPLE_ORDER_TYPES : PAPER_ORDER_TYPES)
    : (uiMode === "simple" ? SIMPLE_ORDER_TYPES : ORDER_TYPES);
  const isLimitType = effectiveOrderType === "LIMIT" || effectiveOrderType === "TAKE_STOP_LIMIT" || effectiveOrderType === "TRIGGER_LIMIT";
  const isStopType = effectiveOrderType.startsWith("TAKE_STOP") || effectiveOrderType.startsWith("TRIGGER");
  const isOco = effectiveOrderType === "OCO";

  const isPaperLimit = isPaper && effectiveOrderType === "LIMIT";

  // 功能5: 盈亏比计算
  const riskReward = useMemo(() => {
    if (!isStopType || !price || !stopPrice) return null;
    const p = parseFloat(price);
    const sp = parseFloat(stopPrice);
    if (!p || !sp || p <= 0 || sp <= 0 || sp >= p) return null;
    const diff = p - sp;
    const pct = (diff / sp) * 100;
    const qty = parseFloat(amount);
    const usdt = qty > 0 ? qty * p : 0;
    return { diff, pct, usdt };
  }, [isStopType, price, stopPrice, amount, currentPrice]);

  const handlePercent = (pct: number) => {
    setPercent(pct);
    if (isPaper) {
      if (side === "SELL") {
        // 卖出时按持仓量计算
        if (holdingQty > 0) {
          setAmount(((holdingQty * pct) / 100).toFixed(6));
        }
      } else if (isPaperLimit) {
        const limitP = parseFloat(price) || currentPrice;
        if (limitP > 0) {
          const balance = paperData?.account.balance_usdt ?? 0;
          setAmount(((balance * pct) / 100 / limitP).toFixed(6));
        }
      } else {
        const balance = paperData?.account.balance_usdt ?? 0;
        setAmount(((balance * pct) / 100).toFixed(2));
      }
    } else if (effectiveOrderType === "MARKET") {
      setAmount(String(pct));
    } else {
      setAmount(pct.toString());
    }
  };

  const canOpenConfirm = () => {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) return false;
    if (isPaperLimit) {
      if (!price || parseFloat(price) <= 0) return false;
    }
    if (!isPaper) {
      if (isLimitType && (!price || parseFloat(price) <= 0)) return false;
      if (isStopType && (!stopPrice || parseFloat(stopPrice) <= 0)) return false;
      if (isOco && (!price || !stopPrice)) return false;
    }
    return true;
  };

  const executeOrder = async () => {
    setSubmitting(true);
    setResult(null);

    try {
      if (isPaper) {
        if (isPaperLimit) {
          const order = await placePaperOrder.mutateAsync({
            symbol,
            side: side === "BUY" ? "buy" : "sell",
            quoteAmount: parseFloat(amount),
            orderType: "limit",
            price: parseFloat(price),
          });
          setResult({ ok: true, message: `${side} LIMIT ${symbol} · ${formatPrice(parseFloat(price))} x ${amount}` });
          setAmount(""); setPercent(0); setPrice("");
        } else {
          const order = await placePaperOrder.mutateAsync({
            symbol,
            side: side === "BUY" ? "buy" : "sell",
            quoteAmount: parseFloat(amount),
          });
          setResult({ ok: true, message: `${side} ${symbol} · 成交价 ${formatPrice(order.price)}` });
          setAmount(""); setPercent(0);
        }
      } else {
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
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const amountUsdtForConfirm = isPaper
    ? (isPaperLimit
        ? (parseFloat(amount) || 0) * (parseFloat(price) || currentPrice)
        : parseFloat(amount) || 0)
    : (effectiveOrderType === "MARKET"
        ? parseFloat(amount) || 0
        : (parseFloat(amount) || 0) * (isLimitType && price ? parseFloat(price) : currentPrice));

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
        {/* Simple / Pro toggle */}
        <div className="flex items-center justify-end gap-1">
          <div className="flex rounded-xs bg-bg-tertiary p-0.5 text-xs">
            <button
              onClick={() => { setUiMode("simple"); if (orderType !== "MARKET" && orderType !== "LIMIT") setOrderType("MARKET"); }}
              className={cn("rounded-xs px-2 py-0.5", uiMode === "simple" ? "bg-bg-primary text-text-primary" : "text-text-muted")}
            >简单</button>
            <button
              onClick={() => setUiMode("pro")}
              className={cn("rounded-xs px-2 py-0.5", uiMode === "pro" ? "bg-bg-primary text-text-primary" : "text-text-muted")}
            >专业</button>
          </div>
        </div>

        {/* Order Type */}
        <div>
          <div className="text-xs text-text-muted mb-1">Type</div>
          <div className="grid grid-cols-2 gap-1">
            {visibleOrderTypes.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setOrderType(key)}
                className={cn("rounded-xs py-1 text-xs font-medium", effectiveOrderType === key ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary")}
              >{label}</button>
            ))}
          </div>
          <p className="text-xs text-text-muted/60 mt-1">{ORDER_TYPES.find(t => t.key === effectiveOrderType)?.desc}</p>
        </div>

        {/* TIF */}
        {isLimitType && (
          <div className="flex gap-1">
            {(isPaper ? (["GTC"] as TIF[]) : TIF_OPTIONS).map((t) => (
              <button key={t} onClick={() => setTif(t)}
                className={cn("flex-1 rounded-xs py-0.5 text-xs", tif === t ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted")}
              >{t}</button>
            ))}
          </div>
        )}

        {/* Price */}
        {isLimitType && (
          <div>
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>{isOco ? "Limit Price" : isPaperLimit ? "Limit Price" : "Price"}</span>
              <span>≈ {formatPrice(currentPrice)}</span>
            </div>
            <Input placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)}
              className="text-sm" />
          </div>
        )}

        {/* Market price display for non-limit */}
        {!isLimitType && (
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Market Price</span>
            <span className="text-text-primary">≈ {formatPrice(currentPrice)}</span>
          </div>
        )}

        {/* Stop Price */}
        {!isPaper && isStopType && (
          <div>
            <div className="text-xs text-text-muted mb-1">Stop Price</div>
            <Input placeholder="0.00" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className="text-sm" />
          </div>
        )}

        {/* OCO Stop Price + Limit */}
        {!isPaper && isOco && (
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
            <span>{(!isPaper && effectiveOrderType !== "MARKET") ? "Quantity" : isPaperLimit ? "Quantity" : "Amount (USDT)"}</span>
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
          {isPaper && (
            <p className="mt-1 text-xs text-text-muted">
              {side === "SELL" && holdingQty > 0
                ? `持仓 ${formatPrice(holdingQty)} ${symbol.split("-")[0]}`
                : `可用 ${formatPrice(paperData?.account.balance_usdt ?? 0)} USDT`
              }
            </p>
          )}
        </div>

        {/* 功能5: 盈亏比联动显示 */}
        {riskReward && (
          <div className="text-xs text-text-muted space-y-0.5">
            <div className="flex justify-between">
              <span>预估风险/收益</span>
              <span>
                {riskReward.pct.toFixed(2)}% / ≈ {formatPrice(riskReward.usdt)} USDT
              </span>
            </div>
          </div>
        )}

        <Button
          className="w-full"
          variant={side === "BUY" ? "green" : "red"}
          disabled={!canOpenConfirm()}
          onClick={() => setConfirmOpen(true)}
        >
          {`${side} ${isPaperLimit ? "LIMIT" : ""} ${symbol.split("-")[0]}`}
        </Button>

        {result && (
          <div className={cn("rounded-xs px-3 py-2 text-xs", result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
            {result.message}
          </div>
        )}
      </div>

      <OrderConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeOrder}
        loading={submitting}
        side={side}
        symbol={symbol}
        orderTypeLabel={isPaper && isPaperLimit ? "Limit" : ORDER_TYPES.find((t) => t.key === effectiveOrderType)?.label ?? effectiveOrderType}
        amountUsdt={amountUsdtForConfirm}
        price={isLimitType && price ? parseFloat(price) : currentPrice}
        balanceUsdt={isPaper ? paperData?.account.balance_usdt : undefined}
        isPaper={isPaper}
      />
    </div>
  );
}
