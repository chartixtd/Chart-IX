import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "green" | "red";
type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "foil-sheen gold-gradient text-bg-primary font-semibold shadow-gold hover:brightness-[1.06] active:brightness-95",
  secondary:
    "bg-bg-tertiary text-text-primary border border-border-default hover:bg-bg-hover hover:border-border-hover",
  outline:
    "border border-gold/60 text-gold hover:bg-gold/10 hover:border-gold active:bg-gold/15",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
  danger:
    "bg-danger/10 text-danger border border-danger/25 hover:bg-danger/20",
  green:
    "bg-success/12 text-success border border-success/25 hover:bg-success/20 font-semibold",
  red:
    "bg-danger/12 text-danger border border-danger/25 hover:bg-danger/20 font-semibold",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-xs rounded-sm",
  md: "px-5 py-2.5 text-sm rounded-sm",
  lg: "px-7 py-3.5 text-base rounded-md",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-all duration-200",
          "active:scale-[0.97] active:duration-75",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
