"use client";

import { useTranslations } from "next-intl";

interface ReduceOnlyFieldProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

/** 合约"只减仓"开关——开启后 BingX 会拒绝任何会增加持仓的方向 */
export function ReduceOnlyField({ value, onChange }: ReduceOnlyFieldProps) {
  const t = useTranslations();

  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
      <input
        type="checkbox"
        checked={value}
        className="rounded-xs"
        onChange={(e) => onChange(e.target.checked)}
      />
      {t("trading.reduce_only")}
      <span className="text-text-muted/60">({t("trading.reduce_only_hint")})</span>
    </label>
  );
}
