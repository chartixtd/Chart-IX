"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useSpotBalances } from "@/hooks/useTradingAccount";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { translateError } from "./OrderForm";
import { cn, formatPrice } from "@/lib/utils";

interface OcoTicketProps {
  symbol: string;
  direction: "LONG" | "SHORT";
}

/**
 * 现货 OCO（一取消另一）独立下单表单。三个价格（立即挂出的限价、触发价、
 * 触发后挂出的限价）不适合塞进 PriceFields 那套单价格模型，所以单独成组件，
 * 自己管理提交/确认/结果展示，不复用 OrderForm 主流程的 OrderPreview/
 * OrderConfirmModal（它们的 props 形状是为单价格订单设计的）。
 */
export function OcoTicket({ symbol, direction }: OcoTicketProps) {
  const t = useTranslations();
  const baseAsset = symbol.split("-")[0] ?? symbol;
  const side: "BUY" | "SELL" = direction === "LONG" ? "BUY" : "SELL";

  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? Number(ticker.lastPrice) : 0;
  const { data: balances } = useSpotBalances();
  // 卖出方向：可用额度按持有的 baseAsset 数量折算成 USDT 价值，不是账户里
  // 剩余的 USDT 现金——否则「卖出」会按还剩多少 USDT 现金定价，而不是按手上
  // 还有多少 baseAsset 可卖定价。与 OrderForm.tsx 的 availableUsdt 同一个
  // 缺陷、同一个修复（2026-07-29 真实交易测试中发现，见该文件同名注释）。
  const availableUsdt = useMemo(() => {
    if (side === "SELL") {
      const baseBalance = balances?.find((b) => b.asset === baseAsset);
      return baseBalance ? parseFloat(baseBalance.free) * currentPrice : undefined;
    }
    return balances?.find((b) => b.asset === "USDT")
      ? parseFloat(balances.find((b) => b.asset === "USDT")!.free)
      : undefined;
  }, [side, balances, baseAsset, currentPrice]);

  const [notional, setNotional] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canSubmit = () =>
    parseFloat(notional) > 0 &&
    parseFloat(limitPrice) > 0 &&
    parseFloat(triggerPrice) > 0 &&
    parseFloat(orderPrice) > 0;

  const execute = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/bingx/trade/oco-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place",
          symbol, side,
          notionalUsdt: parseFloat(notional),
          limitPrice, triggerPrice, orderPrice,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(translateError(json, t));
      setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderListId ?? "" }) });
      setNotional(""); setLimitPrice(""); setTriggerPrice(""); setOrderPrice("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : t("bingx_error.network") });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex-1 space-y-2.5 p-3">
      <p className="text-xs text-text-muted/70">{t("trading.oco.hint")}</p>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.oco.limit_price")}</span>
          <span className="font-mono tabular-nums">≈ {formatPrice(currentPrice)}</span>
        </div>
        <Input placeholder="0.00" inputMode="decimal" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 text-xs text-text-muted">{t("trading.oco.trigger_price")}</div>
        <Input placeholder="0.00" inputMode="decimal" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 text-xs text-text-muted">{t("trading.oco.order_price")}</div>
        <Input placeholder="0.00" inputMode="decimal" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} className="text-sm" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.amount_label")}</span>
          {availableUsdt !== undefined && (
            <span>{t("trading.available")}: <span className="font-mono text-text-primary">{availableUsdt.toFixed(2)} USDT</span></span>
          )}
        </div>
        <Input placeholder="0.00" inputMode="decimal" value={notional} onChange={(e) => setNotional(e.target.value)} className="text-sm" />
      </div>

      <Button
        className="w-full"
        variant={direction === "LONG" ? "green" : "red"}
        disabled={!canSubmit()}
        onClick={() => setConfirmOpen(true)}
      >
        {t(direction === "LONG" ? "trading.side.buy" : "trading.side.sell")} {baseAsset} OCO
      </Button>

      {result && (
        <div className={cn("rounded-xs px-3 py-2 text-xs", result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
          {result.message}
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`OCO · ${symbol}`} size="sm">
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <span className="text-text-muted">{t("trade.orders.side")}</span>
            <span className="text-right">{t(direction === "LONG" ? "trading.side.buy" : "trading.side.sell")}</span>
            <span className="text-text-muted">{t("trading.oco.limit_price")}</span>
            <span className="text-right font-mono">{limitPrice}</span>
            <span className="text-text-muted">{t("trading.oco.trigger_price")}</span>
            <span className="text-right font-mono">{triggerPrice}</span>
            <span className="text-text-muted">{t("trading.oco.order_price")}</span>
            <span className="text-right font-mono">{orderPrice}</span>
            <span className="text-text-muted">{t("trading.amount_label")}</span>
            <span className="text-right font-mono">{notional} USDT</span>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" size="sm" disabled={submitting} onClick={execute}>
              {submitting ? "…" : t("trading.confirm_button")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
