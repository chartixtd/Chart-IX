import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  /**
   * data  = 数据面（后台表单、密集列表）：6px 圆角，不透明面板
   * content = 内容面（营销、认证、Bento）：16px 圆角
   */
  tone?: "data" | "content";
  /**
   * glass 用黑曜石玻璃（backdrop-filter）。**交易终端一律不要用**——
   * 高频重绘叠 backdrop-filter 在低端安卓上会把帧率打到 30 以下。
   */
  surface?: "panel" | "glass";
}

const paddings = {
  none: "",
  sm: "p-3.5",
  md: "p-5",
  lg: "p-7",
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
        tone === "data" ? "rounded-md" : "rounded-xl",
        surface === "glass" ? "obsidian-glass" : "panel shadow-card",
        hover &&
          "transition-all duration-300 hover:border-gold/40 hover:shadow-[inset_0_1px_0_rgba(235,208,138,0.14),0_10px_34px_-8px_rgba(201,162,75,0.25)] hover:-translate-y-0.5",
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
