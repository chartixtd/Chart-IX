import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "gold" | "green" | "red" | "orange" | "blue" | "gray";
  size?: "sm" | "md";
  className?: string;
}

const variantClasses = {
  gold: "bg-gold/15 text-gold border-gold/30",
  green: "bg-success/15 text-success border-success/30",
  red: "bg-danger/15 text-danger border-danger/30",
  orange: "bg-warning/15 text-warning border-warning/30",
  blue: "bg-info/15 text-info border-info/30",
  gray: "bg-bg-tertiary text-text-secondary border-border-default",
};

export function Badge({ children, variant = "gray", size = "sm", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
