import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 登录后各页共用的版式原语。
 *
 * 这些页面此前只换了字重、没换构图，读起来像同一套控件换了层皮。三件事让
 * 它们成为一个体系：区块标题是展示级而不是 text-lg、结构由发丝线承担而不是
 * 卡片、数字有自己的字号阶。
 */

/** 区块标题：展示级字号 + 左侧一段金线，右侧可挂一个动作。 */
export function SectionHeading({
  title,
  action,
  count,
  className,
}: {
  title: string;
  action?: ReactNode;
  /** 右侧的计数（如 3/12）。走等宽，不与标题争视觉。 */
  count?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2", className)}>
      <h2 className="section-mark display text-display-sm">{title}</h2>
      {(action || count) && (
        <div className="flex items-baseline gap-5">
          {count && <span className="font-mono text-xs tabular-nums text-text-muted">{count}</span>}
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * 一排刻度式数据。发丝线分栏，标签在上、数字在下。
 * 这是账户对账单的语法：不是四张卡片，是一条被竖线切开的横带。
 */
export function StatRow({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; tone?: "default" | "up" | "down" | "gold" }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden border-y border-border-default bg-border-default sm:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-bg-primary px-1 py-5 sm:px-5 sm:first:pl-0">
          <dt className="eyebrow">{item.label}</dt>
          <dd
            className={cn(
              "mt-3 font-mono text-base tabular-nums sm:text-lg",
              item.tone === "up" && "text-success",
              item.tone === "down" && "text-danger",
              item.tone === "gold" && "text-gold",
              (!item.tone || item.tone === "default") && "text-text-primary"
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 下划线式分栏切换。全站第三次出现同一个手势（顶栏、筛选器、这里），
 * 到这个份上它就是这个产品的「我在哪一栏」的标准写法。
 */
export function SegmentTabs({
  options,
  value,
  onChange,
  className,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("custom-scrollbar -mb-px flex items-center gap-1 overflow-x-auto", className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-current={value === o.key ? "true" : undefined}
          className={cn(
            "inline-flex min-h-[44px] items-center whitespace-nowrap border-b px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors lg:min-h-0 lg:py-3",
            value === o.key
              ? "border-gold text-gold"
              : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
