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

/**
 * 选币口径带。
 *
 * 此前是一张灰卡里横排四个小项。现在是一条被发丝线切开的横带（与 StatRow
 * 同一套语法）：标签在上、值在下，四格等宽。它读起来是仪器面板上的一排刻度，
 * 不是一个「筛选器」控件组——因为其中三格本来就不可调。
 *
 * 成交量、振幅、市值三条门槛全部由服务端执行，这里只读地标出来。做成静态
 * 文字而不是禁用的控件：禁用的控件仍然长得像「可以调，只是现在不行」，
 * 而这三条是产品定死的选币口径，不该给出可调的暗示。
 *
 * 振幅这一格说的是「取最安静的 20 个」而不是某个门槛值：选币取的是**最安静**
 * 的 N 个，不是最吵的。理由见 types.ts 的 QUIET_RANK_TAKE 注释（高振幅档
 * 捕获率只有 33%，且六成情况回吐大于延续）。
 *
 * 方向是唯一可调的一格。它只决定表格显示哪些行，不改变任何币的分数。
 */
export function ScreenerFilters({
  value,
  onChange,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const t = useTranslations("screener");

  return (
    // 手机上是 2 列 3 行：两个数字门槛并排，「振幅」与「方向」各占整行——
    // 「取最安静的 20 个」七个汉字与三段式方向控件都放不进半行（马来文的
    // Semua / Short 更宽）。sm 起回到一行四格，order 把顺序摆回
    // 成交量 → 振幅 → 市值 → 方向。
    <dl className="grid grid-cols-2 gap-px overflow-hidden border-y border-border-default bg-border-default sm:grid-cols-4">
      <div className="order-1 bg-bg-primary px-1 py-5 sm:px-5 sm:first:pl-0">
        <dt className="eyebrow">{t("filters.volume")}</dt>
        <dd className="mt-3 font-mono text-base tabular-nums text-text-primary sm:text-lg">
          {SERVER_GATE.minVolumeUsd / 1_000_000}
          <span className="ml-1.5 text-xs text-text-muted">M USDT</span>
        </dd>
      </div>

      <div className="order-3 col-span-2 bg-bg-primary px-1 py-5 sm:order-2 sm:col-span-1 sm:px-5">
        <dt className="eyebrow">{t("filters.amplitude")}</dt>
        <dd className="mt-3 text-base text-text-primary sm:text-lg">
          {t("filters.quiet_rank", { n: QUIET_RANK_TAKE })}
        </dd>
      </div>

      <div className="order-2 bg-bg-primary px-1 py-5 sm:order-3 sm:px-5">
        <dt className="eyebrow">{t("filters.market_cap")}</dt>
        <dd className="mt-3 font-mono text-base tabular-nums text-text-primary sm:text-lg">
          {SERVER_GATE.minMarketCap / 1_000_000}
          <span className="ml-1.5 text-xs text-text-muted">M</span>
        </dd>
      </div>

      <div className="order-4 col-span-2 bg-bg-primary px-1 py-5 sm:col-span-1 sm:px-5">
        <dt className="eyebrow">{t("filters.direction")}</dt>
        <dd className="mt-3">
          {/* 手机上三段等分撑满整行（每段都够 44px 命中区）；桌面收回到自然宽度 */}
          <div
            role="radiogroup"
            aria-label={t("filters.direction")}
            className="flex overflow-hidden rounded-sm border border-border-default sm:inline-flex"
          >
            {DIRECTIONS.map((d, i) => {
              const active = value.direction === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, direction: d })}
                  className={cn(
                    "min-h-[44px] flex-1 whitespace-nowrap px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors sm:flex-none lg:min-h-0 lg:h-8",
                    i > 0 && "border-l border-border-default",
                    active
                      ? "bg-gold/10 text-gold"
                      : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
                  )}
                >
                  {t(`filters.dir_${d}`)}
                </button>
              );
            })}
          </div>
        </dd>
      </div>
    </dl>
  );
}
