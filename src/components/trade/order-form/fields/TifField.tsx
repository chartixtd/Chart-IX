"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type TimeInForceOption = "GTC" | "PostOnly" | "IOC" | "FOK";

const OPTIONS: TimeInForceOption[] = ["GTC", "PostOnly", "IOC", "FOK"];

interface TifFieldProps {
  value: TimeInForceOption;
  onChange: (v: TimeInForceOption) => void;
}

/** 限价单的成交时效选择——只在专业模式下由 OrderForm 决定是否渲染 */
export function TifField({ value, onChange }: TifFieldProps) {
  const t = useTranslations();

  return (
    <div>
      <div className="mb-1 text-xs text-text-muted">{t("trading.time_in_force")}</div>
      <div className="grid grid-cols-4 gap-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-xs py-1 text-xs font-medium",
              value === opt ? "bg-bg-hover text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {t(`trading.tif.${opt.toLowerCase()}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
