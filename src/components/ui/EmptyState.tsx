import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {icon && (
        // 图标坐在一枚发丝金圆环里，空状态才不至于是"一片什么都没有"
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.06] text-gold">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold tracking-tight text-text-primary">
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
      <div className="hairline-gold mt-8 w-12 opacity-40" />
    </div>
  );
}
