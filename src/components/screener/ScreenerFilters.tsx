"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SERVER_GATE } from "@/lib/screener/universe";
import { QUIET_RANK_TAKE } from "@/lib/screener/types";
// FilterState / DEFAULT_FILTERS / DirectionFilter 的唯一定义放在 src/lib/screener/filter.ts
// （不能在组件里再声明一份 —— 两份定义漂移之后控件和过滤逻辑会对不上，TS 不会报错；
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
      {/* 成交量、振幅、市值三条门槛全部由服务端执行，这里只读地标出来。
          做成静态文字而不是禁用的控件：禁用的控件仍然长得像「可以调，只是
          现在不行」，而这三条是产品定死的筛选口径，不该给出可调的暗示。 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.volume")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          <b className="text-text-primary">{SERVER_GATE.minVolumeUsd / 1_000_000}</b>M USDT
        </span>
      </div>

      {/* 振幅曾经是这里唯一可调的滑块，后来变成只读说明。现在连含义都变了：
          选币取的是**最安静**的 N 个，不是最吵的——所以这里说的是
          「取最安静的 20 个」，而不是某个门槛值。理由见 types.ts 的
          QUIET_RANK_TAKE 注释（高振幅档捕获率只有 33%，且六成情况回吐
          大于延续）。 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          {t("filters.amplitude")}
        </span>
        <span className="tnum text-xs text-text-secondary">
          {t("filters.quiet_rank", { n: QUIET_RANK_TAKE })}
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
                "min-h-[44px] px-3 py-1.5 text-xs transition-colors lg:min-h-0",
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
