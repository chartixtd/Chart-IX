"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Input";
import { formatPrice } from "@/lib/utils";
import { LIMIT_TYPES, STOP_TYPES, TRAILING_TYPES, TPSL_ATTACHABLE } from "../config";

interface PriceFieldsProps {
  orderType: string;
  currentPrice: number;
  price: string;
  onPriceChange: (v: string) => void;
  stopPrice: string;
  onStopPriceChange: (v: string) => void;
  callbackPercent: string;
  onCallbackPercentChange: (v: string) => void;
  tpPrice: string;
  onTpPriceChange: (v: string) => void;
  slPrice: string;
  onSlPriceChange: (v: string) => void;
  showTpSl: boolean;
  onToggleTpSl: (v: boolean) => void;
}

export function PriceFields(p: PriceFieldsProps) {
  const t = useTranslations();
  const isLimit = LIMIT_TYPES.has(p.orderType);
  const isStop = STOP_TYPES.has(p.orderType);
  const isTrailing = TRAILING_TYPES.has(p.orderType);
  const canAttachTpSl = TPSL_ATTACHABLE.has(p.orderType);

  return (
    <>
      {isLimit ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>{t("trading.limit_price")}</span>
            <span className="font-mono tabular-nums">≈ {formatPrice(p.currentPrice)}</span>
          </div>
          <Input
            placeholder="0.00" inputMode="decimal" value={p.price}
            onChange={(e) => p.onPriceChange(e.target.value)} className="text-sm"
          />
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{t("trading.market_price")}</span>
          <span className="font-mono tabular-nums text-text-primary">{formatPrice(p.currentPrice)}</span>
        </div>
      )}

      {isStop && (
        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.stop_price")}</div>
          <Input
            placeholder="0.00" inputMode="decimal" value={p.stopPrice}
            onChange={(e) => p.onStopPriceChange(e.target.value)} className="text-sm"
          />
        </div>
      )}

      {isTrailing && (
        <div>
          <div className="mb-1 text-xs text-text-muted">{t("trading.callback_rate")}</div>
          <Input
            placeholder="1" inputMode="decimal" value={p.callbackPercent}
            onChange={(e) => p.onCallbackPercentChange(e.target.value)} className="text-sm"
          />
          <p className="mt-0.5 text-xs text-text-muted/60">
            {t("trading.callback_rate_hint", { pct: p.callbackPercent || "1" })}
          </p>
        </div>
      )}

      {canAttachTpSl && (
        <div className="border-t border-border-default pt-2">
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox" checked={p.showTpSl} className="rounded-xs"
              onChange={(e) => p.onToggleTpSl(e.target.checked)}
            />
            {t("trading.set_tp_sl")}
          </label>
          {p.showTpSl && (
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-xs text-text-muted">{t("trading.take_profit_price")}</div>
                <Input
                  placeholder="0.00" inputMode="decimal" value={p.tpPrice}
                  onChange={(e) => p.onTpPriceChange(e.target.value)} className="text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-text-muted">{t("trading.stop_loss_price")}</div>
                <Input
                  placeholder="0.00" inputMode="decimal" value={p.slPrice}
                  onChange={(e) => p.onSlPriceChange(e.target.value)} className="text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
