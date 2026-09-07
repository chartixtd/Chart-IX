import { cn } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { FactorBreakdown } from "@/lib/screener/types";

/**
 * 警报卡上的因子读数。
 *
 * 取代了原来的两根竖条。竖条在表格里（FactorStack，5px 宽）是对的——
 * 那里它只是一个占一格的缩略图示。但搬到警报卡上就不成立了：卡片里
 * 两根竖条被推到左右两端，中间空出一大片，读者既比不出高低（相距太远），
 * 也看不出「占满分多少」（槽太窄）。
 *
 * 两种排法：
 *   rows = 标签、横条、分数在同一行，两行上下相邻（旧版卡片）。
 *   pair = 两格并排，每格「标签 … 分数」一行、细条在下。给新版卡片用：
 *          卡片其余部分全是横向成对的元素（两个数、两条参考线、两个价格），
 *          因子也并排，整张卡才只有一种节奏。
 *
 * **按各自满分归一**，不是按同一个分母：OI 满分 60、CVD 满分 40，
 * 用同一个分母的话一个拿满 40 分的 CVD 会显得比一个 45 分的 OI 更短，
 * 读者会以为它更差。这条是从 FactorStack 继承来的，不能丢。
 */
const ROWS = [
  ["oi", "OI"],
  ["cvd", "CVD"],
] as const;

export function FactorMeter({
  factors,
  fillClassName,
  layout = "rows",
  className,
}: {
  factors: FactorBreakdown;
  /** 填充色，跟着场景基调走 */
  fillClassName: string;
  layout?: "rows" | "pair";
  className?: string;
}) {
  if (layout === "pair") {
    return (
      <div className={cn("grid grid-cols-2 gap-4", className)}>
        {ROWS.map(([key, label]) => {
          const max = FACTOR_MAX[key];
          const value = factors[key];
          const ratio = Math.max(0, Math.min(1, value / max));
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">{label}</span>
                <span className="tnum font-mono text-[11px] text-text-secondary">
                  {value}
                  <span className="text-text-muted">/{max}</span>
                </span>
              </div>
              <span
                className="relative mt-2 block h-0.5 w-full overflow-hidden bg-border-strong"
                role="img"
                aria-label={`${label} ${value}/${max}`}
              >
                <span
                  className={cn("absolute inset-y-0 left-0", fillClassName)}
                  // 最短也留 3px：0 分和「没渲染出来」在视觉上必须能区分。
                  style={{ width: `max(3px, ${(ratio * 100).toFixed(1)}%)` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {ROWS.map(([key, label]) => {
        const max = FACTOR_MAX[key];
        const value = factors[key];
        const ratio = Math.max(0, Math.min(1, value / max));
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] font-medium tracking-wider text-text-muted">
              {label}
            </span>
            <span
              className="relative h-1 flex-1 overflow-hidden rounded-none bg-bg-hover"
              role="img"
              aria-label={`${label} ${value}/${max}`}
            >
              <span
                className={cn("absolute inset-y-0 left-0", fillClassName)}
                style={{ width: `max(3px, ${(ratio * 100).toFixed(1)}%)` }}
              />
            </span>
            <span className="tnum w-11 shrink-0 text-right text-[10px] text-text-secondary">
              {value}
              <span className="text-text-muted">/{max}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
