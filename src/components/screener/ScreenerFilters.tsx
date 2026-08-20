"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SERVER_GATE } from "@/lib/screener/universe";
import { AMPLITUDE_RANK_TAKE } from "@/lib/screener/types";
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

      {/* 振幅曾经是这里唯一可调的滑块。选币改成「按振幅排名取前 N 个」之后
          它就失效了——能进榜的行振幅实测都在 14% 以上，而滑块范围是 1.5–3%，
          拉到头也筛不掉任何一行。换成和成交量/市值一样的只读说明。 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.amplitude")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          {t("filters.amplitude_rank", { n: AMPLITUDE_RANK_TAKE })}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.market_cap")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{SERVER_GATE.minMarketCap / 1_000_000}</b>M
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
