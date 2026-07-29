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
import { cn, formatPrice } from "@/lib/utils";

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
  /**
   * 已在交易所确认、且与当前方向匹配的杠杆。只由两处写入：
   * 1) LeverageField 的 onApply 成功回读之后（handleLeverageConfirmed）；
   * 2) useFuturesAccount 的方向感知重新拉取结果（下方 effect）。
   * 方向切换时立即清空——BingX 的已确认杠杆是按 symbol+positionSide 存的，
   * 上一侧确认过不代表这一侧也确认过。canSubmit() 会在合约市场强制要求
   * confirmedLeverage 非空且方向匹配，否则禁用主按钮，从结构上杜绝
   * "未在交易所确认的杠杆" 进入下单请求体。
   */
  const [confirmedLeverage, setConfirmedLeverage] = useState<{ value: number; direction: "LONG" | "SHORT" } | null>(null);
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
  const { data: futuresAccount } = useFuturesAccount(symbol, direction, market === "futures");

  // 切换到不支持的订单类型时回退到市价
  const availableTypes = uiMode === "simple" ? cfg.simpleTypes : cfg.proTypes;
  useEffect(() => {
    if (!availableTypes.includes(orderType)) setOrderType("MARKET");
  }, [availableTypes, orderType]);

  // 交易所实际杠杆是权威值，UI 跟随它；同时把它标记为"已确认"，方向匹配才算数。
  // 两件事必须在同一个 effect 里做完：如果拆成"同步已确认值"与"方向变化就清空"
  // 两个独立 effect，同一次 commit 里两者都会触发，后声明的"清空"总会覆盖掉前面
  // 刚设好的确认值——哪怕新方向的杠杆数据其实已经在缓存里、本可以立刻可信。
  useEffect(() => {
    if (market !== "futures") return;
    if (futuresAccount?.leverage) {
      setLeverage(futuresAccount.leverage);
      setConfirmedLeverage({ value: futuresAccount.leverage, direction });
    } else {
      // 该方向还没有可信数据（例如刚切换方向、新 queryKey 尚未取回）：
      // 宁可暂时禁用提交，也不能让上一方向确认过的杠杆继续被当作"已确认"
      setConfirmedLeverage(null);
    }
  }, [market, futuresAccount?.leverage, direction]);

  // TP/SL 只对合约有意义（现货/模拟盘下单接口根本不接受这两个字段）；
  // 切到不支持的市场或方向变化后残留的旧值不应该悄悄带入下一次下单
  useEffect(() => {
    if (market !== "futures" && showTpSl) {
      setShowTpSl(false);
      setTpPrice("");
      setSlPrice("");
    }
  }, [market, showTpSl]);

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
    // 合约：杠杆必须是交易所已确认过的值，且确认时的方向要和当前方向一致
    // （见 confirmedLeverage 的注释——这是结构性拦截，不是提示/警告）
    if (market === "futures") {
      if (!confirmedLeverage || confirmedLeverage.direction !== direction) return false;
    }
    // 附带止盈止损：非空字段必须能解析成正数；两个都留空视为"未设置"，不算错误
    if (showTpSl) {
      const tpValid = tpPrice.trim() === "" || parseFloat(tpPrice) > 0;
      const slValid = slPrice.trim() === "" || parseFloat(slPrice) > 0;
      if (!tpValid || !slValid) return false;
    }
    return true;
  };

  const handleLeverageConfirmed = (lev: number) => {
    setLeverage(lev);
    // localOnly（模拟盘）也会走到这里，但模拟盘不受 confirmedLeverage 门槛约束，
    // 只在合约市场标记为"已确认"
    if (market === "futures") setConfirmedLeverage({ value: lev, direction });
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
      if (!cfg.isLive) {
        // 模拟盘：不涉及真实资金，走本地账本而不是任何 BingX 下单接口
        const order = await placePaperOrder.mutateAsync({
          symbol,
          side: direction === "LONG" ? "buy" : "sell",
          quoteAmount: notional,
          leverage,
          ...(isLimit ? { orderType: "limit" as const, price: parseFloat(price) } : {}),
        });
        setResult({
          ok: true,
          message: t("trading.paper_placed", { symbol, price: formatPrice(Number(order.price ?? refPrice)) }),
        });
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
            type="button"
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
                type="button"
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
                type="button"
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
            onLocalChange={handleLeverageConfirmed}
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
          allowTpSl={market === "futures"}
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

/**
 * 服务端返回 i18nKey 时优先用它翻译，否则回落到原始信息。
 *
 * next-intl 的 t() 在 key 缺失时默认不抛异常——它只打印 warning 并把 key 原样
 * 当字符串返回，所以不能用 try/catch 判断"key 是否存在"（catch 分支永远不会触发）。
 * 两条订单路由都会用 `pre.code` 动态拼出 i18nKey（`trading.reject.${code}`），
 * 未来新增的风控原因码在前端补齐翻译之前会命中这个分支，必须显式用 t.has() 检查。
 */
export function translateError(json: { error?: { i18nKey?: string; message?: string; limit?: unknown } }, t: ReturnType<typeof useTranslations>): string {
  const key = json.error?.i18nKey;
  if (key && t.has(key)) {
    return t(key, { limit: String(json.error?.limit ?? "") });
  }
  return json.error?.message || "Order failed";
}
