"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CLIENT_SLIDER } from "@/lib/screener/universe";
// FilterState / DEFAULT_FILTERS / DirectionFilter 的唯一定义放在 src/lib/screener/filter.ts
// （不能在组件里再声明一份 —— 两份定义漂移之后滑块和过滤逻辑会对不上，TS 不会报错；
// 且 vitest 只收集 src/lib 下的测试文件，筛选逻辑必须住在 src/lib 才测得到）。
import type { FilterState, DirectionFilter } from "@/lib/screener/filter";
export type { FilterState, DirectionFilter };
export { DEFAULT_FILTERS } from "@/lib/screener/filter";

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
