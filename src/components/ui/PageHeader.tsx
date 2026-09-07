import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 阅读面与操作面共用的页头：轻字重展示标题 + 可选副标 + 右侧操作区，
 * 底下一条发丝线。所有内容页从同一处落下，版式才会读成同一个世界。
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  size = "lg",
  className,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <header className={cn("border-b border-border-default pb-8", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          {eyebrow && <p className="section-mark eyebrow-gold mb-5">{eyebrow}</p>}
          <h1 className={cn("display", size === "lg" ? "text-display-lg" : "text-display-md")}>{title}</h1>
          {subtitle && <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary lg:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/** 下划线式筛选标签：一条基线，当前项金色 */
export function FilterTabs({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("custom-scrollbar -mb-px flex items-center gap-1 overflow-x-auto", className)}>{children}</div>
  );
}

export const FILTER_TAB =
  "inline-flex min-h-[44px] items-center whitespace-nowrap border-b px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors lg:min-h-0 lg:py-3";
export const FILTER_TAB_ACTIVE = "border-gold text-gold";
export const FILTER_TAB_IDLE = "border-transparent text-text-muted hover:text-text-primary";
