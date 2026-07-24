import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddings = {
  none: "",
  sm: "p-3.5",
  md: "p-5",
  lg: "p-7",
};

export function Card({ children, className, hover = false, padding = "md" }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-default bg-bg-secondary shadow-card",
        hover &&
          "transition-all duration-300 hover:border-gold/40 hover:shadow-card-lg hover:-translate-y-0.5",
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
