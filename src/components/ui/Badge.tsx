import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "gold" | "foil" | "green" | "red" | "orange" | "blue" | "gray";
  size?: "sm" | "md";
  className?: string;
}

/**
 * 徽记：大写 + 宽字距 + 锐角。它是「标签」，不是「按钮」——没有底色块的
 * 厚重感，只有一圈发丝描边与一行微字。foil 留给 Pro / 认证这类被烫压上去的标记。
 */
const variantClasses = {
  gold: "border-gold/40 text-gold",
  foil: "foil-sm border-transparent font-semibold",
  green: "border-success/35 text-success",
  red: "border-danger/35 text-danger",
  orange: "border-warning/35 text-warning",
  blue: "border-info/35 text-info",
  gray: "border-border-hover text-text-secondary",
};

export function Badge({ children, variant = "gray", size = "sm", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-sm border font-medium uppercase",
        size === "sm" ? "px-1.5 py-[3px] text-[10px] tracking-[0.14em]" : "px-2.5 py-1 text-[11px] tracking-[0.14em]",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
