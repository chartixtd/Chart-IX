"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CLIENT_SLIDER, SERVER_GATE } from "@/lib/screener/universe";
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
      {/* 成交量与市值已固定成服务端门槛，这里只读地标出来。
          做成静态文字而不是禁用的滑块：禁用滑块仍然长得像「可以调，只是现在不行」，
          而这两条是产品定死的筛选口径，不该给出可调的暗示。 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.volume")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{SERVER_GATE.minVolumeUsd / 1_000_000}</b>M USDT
        </span>
      </div>

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

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.market_cap")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{SERVER_GATE.minMarketCap / 1_000_000}</b>M –{" "}
          {SERVER_GATE.maxMarketCap / 1_000_000}M
        </span>
      </div>

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
