"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/Input";
import { formatNumber, formatPrice, cn } from "@/lib/utils";

interface AmountFieldProps {
  /** 用户输入的仓位名义额（USDT） */
  value: string;
  onChange: (v: string) => void;
  /** 可用余额（USDT）。undefined 表示未知，隐藏百分比按钮 */
  availableUsdt?: number;
  /** 杠杆；名义额上限 = 可用余额 × 杠杆 */
  leverage: number;
  /** 换算出的币数量，用于「≈ 0.0012 BTC」提示 */
  estQty?: number;
  baseAsset: string;
  disabled?: boolean;
}

const PERCENTS = [25, 50, 75, 100];

export function AmountField({
  value, onChange, availableUsdt, leverage, estQty, baseAsset, disabled,
}: AmountFieldProps) {
  const t = useTranslations();
  const buyingPower = availableUsdt !== undefined ? availableUsdt * Math.max(1, leverage) : undefined;

  const applyPercent = (pct: number) => {
    if (buyingPower === undefined) return;
    onChange(((buyingPower * pct) / 100).toFixed(2));
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        {/* 单位始终写明，不随订单类型切换语义 */}
        <span>{t("trading.amount_label")}</span>
        {buyingPower !== undefined && (
          <div className="flex gap-1">
            {PERCENTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => applyPercent(p)}
                className="rounded-xs px-1 text-xs hover:text-gold disabled:opacity-50"
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>

      <Input
        placeholder="0.00"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm"
      />

      <div className="mt-1 space-y-0.5 text-xs text-text-muted">
        {estQty !== undefined && estQty > 0 && (
          <div className={cn("flex justify-between")}>
            <span>{t("trading.est_qty")}</span>
            <span className="font-mono text-text-primary tabular-nums">
              ≈ {formatNumber(estQty, 8)} {baseAsset}
            </span>
          </div>
        )}
        {availableUsdt !== undefined && (
          <div className="flex justify-between">
            <span>{t("trading.available")}</span>
            <span className="font-mono tabular-nums">{formatPrice(availableUsdt)} USDT</span>
          </div>
        )}
      </div>
    </div>
  );
}
