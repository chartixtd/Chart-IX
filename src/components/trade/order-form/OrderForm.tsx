"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSpotTicker } from "@/hooks/useMarketData";
import { usePaperAccount, usePlacePaperOrder } from "@/hooks/usePaperTrading";
import { useSymbolSpec } from "@/hooks/useSymbolSpec";
import { useSpotBalances, useFuturesAccount } from "@/hooks/useTradingAccount";
import { useOrderPreflight } from "@/hooks/useOrderPreflight";
import { Button } from "@/components/ui/Button";
import { OrderConfirmModal } from "@/components/trade/OrderConfirmModal";
import { AmountField } from "./fields/AmountField";
import { LeverageField } from "./fields/LeverageField";
import { PriceFields } from "./fields/PriceFields";
import { OrderPreview } from "./OrderPreview";
import { MARKET_CONFIG, LIMIT_TYPES, STOP_TYPES, TRAILING_TYPES, type OrderFormMarket } from "./config";
import { cn } from "@/lib/utils";

interface OrderFormProps {
  symbol: string;
  market: OrderFormMarket;
  initialSide?: "long" | "short";
}

export function OrderForm({ symbol, market, initialSide }: OrderFormProps) {
  const t = useTranslations();
  const cfg = MARKET_CONFIG[market];
  const baseAsset = symbol.split("-")[0] ?? symbol;

  const [direction, setDirection] = useState<"LONG" | "SHORT">(
    initialSide === "short" ? "SHORT" : "LONG"
  );
  const [uiMode, setUiMode] = useState<"simple" | "pro">("simple");
  const [orderType, setOrderType] = useState("MARKET");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [callbackPercent, setCallbackPercent] = useState("1");
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [showTpSl, setShowTpSl] = useState(false);
  const [leverage, setLeverage] = useState(market === "spot" ? 1 : 10);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const specMarket = market === "spot" ? "spot" : "futures";
  const { data: spec } = useSymbolSpec(symbol, specMarket, direction);
  const { data: ticker } = useSpotTicker(symbol);
  const currentPrice = ticker ? Number(ticker.lastPrice) : 0;

  const { data: paperData } = usePaperAccount(market === "paper");
  const placePaperOrder = usePlacePaperOrder();
  const { data: spotBalances } = useSpotBalances(market === "spot");
  const { data: futuresAccount } = useFuturesAccount(symbol, market === "futures");

  // 切换到不支持的订单类型时回退到市价
  const availableTypes = uiMode === "simple" ? cfg.simpleTypes : cfg.proTypes;
  useEffect(() => {
    if (!availableTypes.includes(orderType)) setOrderType("MARKET");
  }, [availableTypes, orderType]);

  // 交易所实际杠杆是权威值，UI 跟随它
  useEffect(() => {
    if (market === "futures" && futuresAccount?.leverage) setLeverage(futuresAccount.leverage);
  }, [market, futuresAccount?.leverage]);

  const availableUsdt = useMemo(() => {
    if (market === "paper") return paperData?.account.balance_usdt ?? 0;
    if (market === "futures") return futuresAccount?.availableMargin;
    return spotBalances?.find((b) => b.asset === "USDT")
      ? parseFloat(spotBalances.find((b) => b.asset === "USDT")!.free)
      : undefined;
  }, [market, paperData, futuresAccount, spotBalances]);

  const isLimit = LIMIT_TYPES.has(orderType);
  const refPrice = isLimit && parseFloat(price) > 0 ? parseFloat(price) : currentPrice;
  const notional = parseFloat(amount) || 0;
  const effectiveLeverage = cfg.hasLeverage ? leverage : 1;

  const preview = useOrderPreflight({
    spec, notionalUsdt: notional, price: refPrice, leverage: effectiveLeverage, direction,
  });

  const maxLeverage = futuresAccount?.maxLeverage ?? spec?.maxLeverage ?? 125;

  const canSubmit = () => {
    if (!(notional > 0) || !preview.validation?.ok) return false;
    if (isLimit && !(parseFloat(price) > 0)) return false;
    if (STOP_TYPES.has(orderType) && !(parseFloat(stopPrice) > 0)) return false;
    if (TRAILING_TYPES.has(orderType) && !(parseFloat(callbackPercent) > 0)) return false;
    return true;
  };

  const applyLeverage = async (lev: number): Promise<number> => {
    const res = await fetch("/api/bingx/futures/positions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setLeverage", symbol, leverage: lev, positionSide: direction }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || t("trading.leverage_failed"));
    return json.data.leverage as number;
  };

  const applyMarginType = async (marginType: "ISOLATED" | "CROSSED") => {
    const res = await fetch("/api/bingx/futures/positions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setMarginType", symbol, marginType }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || t("trading.margin_type_failed"));
  };

  const execute = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      if (market === "paper") {
        const order = await placePaperOrder.mutateAsync({
          symbol,
          side: direction === "LONG" ? "buy" : "sell",
          quoteAmount: notional,
          leverage,
          ...(isLimit ? { orderType: "limit" as const, price: parseFloat(price) } : {}),
        });
        setResult({ ok: true, message: t("trading.paper_placed", { symbol, price: order.price ?? refPrice }) });
      } else if (market === "spot") {
        const json = await postOrder("/api/bingx/trade/order", {
          symbol, side: direction === "LONG" ? "BUY" : "SELL", type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          timeInForce: isLimit ? "GTC" : undefined,
        });
        if (!json.success) throw new Error(translateError(json, t));
        setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderId ?? "" }) });
      } else {
        const json = await postOrder("/api/bingx/futures/order", {
          symbol, direction, type: orderType,
          notionalUsdt: notional, referencePrice: currentPrice, leverage,
          price: isLimit ? price : undefined,
          stopPrice: STOP_TYPES.has(orderType) ? stopPrice : undefined,
          priceRatePercent: TRAILING_TYPES.has(orderType) ? callbackPercent : undefined,
          takeProfitPrice: showTpSl && tpPrice ? tpPrice : undefined,
          stopLossPrice: showTpSl && slPrice ? slPrice : undefined,
        });
        if (!json.success) throw new Error(translateError(json, t));
        setResult({ ok: true, message: t("trading.order_placed", { id: json.data?.orderIdStr ?? "" }) });
      }
      setAmount(""); setPrice(""); setStopPrice(""); setTpPrice(""); setSlPrice("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : t("bingx_error.network") });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex border-b border-border-default">
        {(["LONG", "SHORT"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={cn(
              "flex-1 py-2.5 text-sm font-semibold",
              direction === d
                ? d === "LONG"
                  ? "border-b-2 border-success bg-success/10 text-success"
                  : "border-b-2 border-danger bg-danger/10 text-danger"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t(d === "LONG" ? cfg.longLabelKey : cfg.shortLabelKey)}
          </button>
        ))}
      </div>

      {/* 多空按钮语义说明：平仓走仓位面板，不用反向下单（缺陷 C2） */}
      {cfg.hasLeverage && (
        <p className="px-3 pt-2 text-xs text-text-muted/70">{t("trading.direction_hint")}</p>
      )}

      <div className="flex-1 space-y-2.5 p-3">
        <div className="flex items-center justify-end">
          <div className="flex rounded-xs bg-bg-tertiary p-0.5 text-xs">
            {(["simple", "pro"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setUiMode(m)}
                className={cn("rounded-xs px-2 py-0.5", uiMode === m ? "bg-bg-primary text-text-primary" : "text-text-muted")}
              >
                {t(`trading.ui_mode.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.order_type")}</div>
          <div className="grid grid-cols-2 gap-1">
            {availableTypes.map((k) => (
              <button
                key={k}
                onClick={() => setOrderType(k)}
                className={cn(
                  "rounded-xs py-1 text-xs font-medium",
                  orderType === k ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`trading.type.${k.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {cfg.hasLeverage && (
          <LeverageField
            value={leverage}
            maxLeverage={maxLeverage}
            marginType={futuresAccount?.marginType}
            onApply={applyLeverage}
            onApplyMarginType={market === "futures" ? applyMarginType : undefined}
            localOnly={market === "paper"}
            onLocalChange={setLeverage}
          />
        )}

        <PriceFields
          orderType={orderType}
          currentPrice={currentPrice}
          price={price} onPriceChange={setPrice}
          stopPrice={stopPrice} onStopPriceChange={setStopPrice}
          callbackPercent={callbackPercent} onCallbackPercentChange={setCallbackPercent}
          tpPrice={tpPrice} onTpPriceChange={setTpPrice}
          slPrice={slPrice} onSlPriceChange={setSlPrice}
          showTpSl={showTpSl} onToggleTpSl={setShowTpSl}
        />

        <AmountField
          value={amount} onChange={setAmount}
          availableUsdt={availableUsdt}
          leverage={effectiveLeverage}
          estQty={preview.sizing?.qty}
          baseAsset={baseAsset}
        />

        <OrderPreview
          preview={preview} spec={spec} baseAsset={baseAsset}
          leverage={effectiveLeverage} showMargin={cfg.hasLeverage}
        />

        <Button
          className="w-full"
          variant={direction === "LONG" ? "green" : "red"}
          disabled={!canSubmit()}
          onClick={() => setConfirmOpen(true)}
        >
          {t(direction === "LONG" ? cfg.longLabelKey : cfg.shortLabelKey)} {baseAsset}
          {cfg.hasLeverage ? ` ${effectiveLeverage}x` : ""}
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
        onConfirm={execute}
        loading={submitting}
        market={market}
        direction={direction}
        symbol={symbol}
        baseAsset={baseAsset}
        orderTypeLabel={t(`trading.type.${orderType.toLowerCase()}`)}
        notionalUsdt={preview.sizing?.notional ?? 0}
        estQty={preview.sizing?.qty ?? 0}
        price={refPrice}
        leverage={effectiveLeverage}
        requiredMarginUsdt={preview.requiredMarginUsdt}
        estLiquidationPrice={preview.estLiquidationPrice}
        availableUsdt={availableUsdt}
      />
    </div>
  );
}

async function postOrder(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 服务端返回 i18nKey 时优先用它翻译，否则回落到原始信息 */
function translateError(json: { error?: { i18nKey?: string; message?: string; limit?: unknown } }, t: ReturnType<typeof useTranslations>): string {
  const key = json.error?.i18nKey;
  if (key) {
    try {
      return t(key, { limit: String(json.error?.limit ?? "") });
    } catch {
      // key 缺失时回落到原文，不吞掉信息
    }
  }
  return json.error?.message || "Order failed";
}
