"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CLIENT_SLIDER } from "@/lib/screener/universe";

export type DirectionFilter = "all" | "long" | "short";

export interface FilterState {
  /** 百万美元 */
  volume: number;
  /** 百分比 */
  amplitude: number;
  /** 百万美元 */
  marketCapFloor: number;
  direction: DirectionFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  volume: CLIENT_SLIDER.volume.default,
  amplitude: CLIENT_SLIDER.amplitude.default,
  marketCapFloor: CLIENT_SLIDER.marketCapFloor.default,
  direction: "all",
};

const DIRECTIONS: DirectionFilter[] = ["all", "long", "short"];

export function ScreenerFilters({
  value,
  onChange,
  count,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  count: number;
}) {
  const t = useTranslations("screener");

  return (
    <div className="mb-4 flex flex-wrap items-end gap-5 rounded-lg panel px-4 py-3">
      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.volume")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.volume.min}
          max={CLIENT_SLIDER.volume.max}
          step={1}
          value={value.volume}
          onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.volume}</b>M USDT
        </span>
      </label>

      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.amplitude")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.amplitude.min}
          max={CLIENT_SLIDER.amplitude.max}
          step={0.5}
          value={value.amplitude}
          onChange={(e) => onChange({ ...value, amplitude: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.amplitude.toFixed(1)}</b>%
        </span>
      </label>

      <label className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.market_cap")}
        </span>
        <input
          type="range"
          min={CLIENT_SLIDER.marketCapFloor.min}
          max={CLIENT_SLIDER.marketCapFloor.max}
          step={10}
          value={value.marketCapFloor}
          onChange={(e) => onChange({ ...value, marketCapFloor: Number(e.target.value) })}
          className="accent-gold"
        />
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{value.marketCapFloor}</b>M – {CLIENT_SLIDER.marketCapCeiling}M
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.direction")}
        </span>
        <div className="flex overflow-hidden rounded-md border border-border-default">
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ ...value, direction: d })}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors",
                value.direction === d
                  ? "bg-gold/15 text-gold"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t(`filters.dir_${d === "all" ? "all" : d}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="tnum ml-auto text-xs text-text-secondary">
        {t("candidate_count", { count })}
      </div>
    </div>
  );
}
