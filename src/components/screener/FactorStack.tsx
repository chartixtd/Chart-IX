import { cn } from "@/lib/utils";
import { FACTOR_MAX } from "@/lib/screener/types";
import type { FactorBreakdown } from "@/lib/screener/types";

const ORDER = ["oi", "cvd"] as const;

/**
 * 两根等高的槽，里面各填一段代表该因子得分占其满分的比例。
 *
 * 关键是**按各自满分归一**而不是按同一个分母统一归一：OI 满分 60、
 * CVD 满分 40，用同一个分母的话一个拿满 40 分的 CVD 看起来会比
 * 一个拿 45 分的 OI 更矮，读者会以为它更差。
 */
export function FactorStack({
  factors,
  size = "sm",
  only,
  fillClassName,
}: {
  factors: FactorBreakdown;
  size?: "sm" | "lg";
  /** 只画其中一根。警报卡的因子明细是「一根柱配一个标签」，不是两根配一个标签。 */
  only?: keyof FactorBreakdown;
  /**
   * 填充色覆盖，默认 bg-gold（原样保留旧行为——表格因子列、警报卡的
   * 无场景兜底样式都不传这个 prop）。六场景警报卡按场景基调换色时传入。
   */
  fillClassName?: string;
}) {
  const track = size === "lg" ? 30 : 20;
  const keys = only ? ([only] as const) : ORDER;

  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {keys.map((key) => {
        const ratio = Math.max(0, Math.min(1, factors[key] / FACTOR_MAX[key]));
        return (
          <i
            key={key}
            className="relative block w-[5px] rounded-[1px] bg-bg-tertiary"
            style={{ height: track }}
          >
            <b
              className={cn(
                "absolute bottom-0 left-0 block w-full rounded-[1px]",
                fillClassName ?? "bg-gold",
                // 最矮也留 3px：0 分和"没渲染出来"在视觉上必须能区分
                "min-h-[3px]"
              )}
              style={{ height: Math.max(3, Math.round(ratio * track)) }}
            />
          </i>
        );
      })}
    </div>
  );
}
