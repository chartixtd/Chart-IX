import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  /**
   * data    = 数据面（后台表单、密集列表）：4px 圆角
   * content = 内容面（营销、认证、Bento）：6px 圆角
   */
  tone?: "data" | "content";
  /**
   * panel   = 墨面（不透明，零 blur）。终端与后台一律用它。
   * glass   = 墨玻璃（backdrop-filter）。只给营销/认证面。
   * outline = 透明底 + 中性描边。用来在同一区块里做次级分组。
   */
  surface?: "panel" | "glass" | "outline";
}

const paddings = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8 lg:p-10",
};

const surfaces = {
  panel: "ink",
  glass: "ink-glass",
  outline: "border border-border-default bg-transparent",
};

export function Card({
  children,
  className,
  hover = false,
  padding = "md",
  tone = "content",
  surface = "panel",
}: CardProps) {
  return (
    <div
      className={cn(
        tone === "data" ? "rounded-md" : "rounded-lg",
        surfaces[surface],
        hover && "ink-hover",
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
