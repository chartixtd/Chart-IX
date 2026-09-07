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
    <div className={cn("flex flex-col items-center justify-center py-20 text-center", className)}>
      {icon && (
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-sm border border-border-hover text-gold">
          {icon}
        </div>
      )}
      <h3 className="font-display text-xl font-medium tracking-tight text-text-primary">{title}</h3>
      {description && (
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
