"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface LeverageFieldProps {
  value: number;
  maxLeverage: number;
  marginType?: string;
  /** 提交到交易所；resolve 为交易所回读的实际杠杆，reject 表示失败 */
  onApply: (leverage: number) => Promise<number>;
  onApplyMarginType?: (marginType: "ISOLATED" | "CROSSED") => Promise<void>;
  /** 模拟盘不打交易所，直接本地设置 */
  localOnly?: boolean;
  onLocalChange?: (leverage: number) => void;
}

const PRESETS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125];

export function LeverageField({
  value, maxLeverage, marginType, onApply, onApplyMarginType, localOnly, onLocalChange,
}: LeverageFieldProps) {
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const presets = PRESETS.filter((p) => p <= maxLeverage);

  const apply = async (lev: number) => {
    if (lev < 1 || lev > maxLeverage) {
      setError(t("trading.leverage_out_of_range", { max: maxLeverage }));
      return;
    }
    setError(null);
    if (localOnly) {
      onLocalChange?.(lev);
      return;
    }
    setPending(true);
    try {
      // 成功时用交易所回读值，而非乐观假设
      const applied = await onApply(lev);
      onLocalChange?.(applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("trading.leverage_failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        <span>{t("trading.leverage")}</span>
        <span className={cn("font-mono tabular-nums", value > 20 ? "font-semibold text-danger" : "text-gold")}>
          {value}x {pending && <span className="ml-1 opacity-60">…</span>}
        </span>
      </div>

      <div className="mb-1 grid grid-cols-5 gap-1">
        {presets.map((l) => (
          <button
            key={l}
            type="button"
            disabled={pending}
            onClick={() => apply(l)}
            className={cn(
              "rounded-xs py-0.5 text-xs font-medium disabled:opacity-50",
              value === l ? "bg-gold/20 text-gold" : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
            )}
          >
            {l}x
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          type="number"
          min={1}
          max={maxLeverage}
          inputMode="numeric"
          placeholder={t("trading.custom_leverage", { max: maxLeverage })}
          value={custom}
          disabled={pending}
          onChange={(e) => setCustom(e.target.value)}
          className="w-full rounded-xs bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-gold/30 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={pending || !custom}
          onClick={() => apply(parseInt(custom, 10))}
          className="rounded-xs bg-bg-hover px-2 text-xs text-text-secondary disabled:opacity-50"
        >
          {t("common.confirm")}
        </button>
      </div>

      {onApplyMarginType && (
        <div className="mt-2 flex gap-1">
          {(["ISOLATED", "CROSSED"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={async () => {
                setError(null);
                setPending(true);
                try {
                  await onApplyMarginType(m);
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("trading.margin_type_failed"));
                } finally {
                  setPending(false);
                }
              }}
              className={cn(
                "flex-1 rounded-xs py-1 text-xs disabled:opacity-50",
                marginType?.toUpperCase() === m
                  ? "bg-gold/20 text-gold"
                  : "bg-bg-tertiary text-text-muted"
              )}
            >
              {t(`trading.margin_type.${m.toLowerCase()}`)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
