import { cn } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { FactorBreakdown } from "@/lib/screener/types";

/**
 * 警报卡上的因子读数：标签、横条、分数在同一行，两行上下相邻。
 *
 * 取代了原来的两根竖条。竖条在表格里（FactorStack，5px 宽）是对的——
 * 那里它只是一个占一格的缩略图示。但搬到警报卡上就不成立了：卡片里
 * 两根竖条被推到左右两端，中间空出一大片，读者既比不出高低（相距太远），
 * 也看不出「占满分多少」（槽太窄）。横条把这两件事一次解决：同一行里
 * 标签紧挨着条、条紧挨着数值（紧的归紧），两行紧邻便于直接比长短。
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
  className,
}: {
  factors: FactorBreakdown;
  /** 填充色，跟着场景基调走 */
  fillClassName: string;
  className?: string;
}) {
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
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary"
              role="img"
              aria-label={`${label} ${value}/${max}`}
            >
              <span
                className={cn("absolute inset-y-0 left-0 rounded-full", fillClassName)}
                // 最短也留 3px：0 分和「没渲染出来」在视觉上必须能区分。
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
