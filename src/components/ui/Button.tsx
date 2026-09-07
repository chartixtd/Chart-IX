import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "green" | "red";
type ButtonSize = "sm" | "md" | "lg";

/**
 * 按钮语法（Ink & Gilt）
 *
 * - primary  = .gilt 实心香槟金。整页只能有一个主操作是它。
 * - outline  = 金色发丝描边，文字金。次级操作。
 * - secondary= 墨面 + 中性描边。表单里的普通操作。
 * - ghost    = 只有文字。导航与低权重操作。
 * - green/red= 涨跌语义按钮，只在下单与筛选器上出现。
 *
 * 全部锐角（2px）。大写 + 宽字距是营销面按钮的签名；CJK 字形不受 uppercase
 * 影响，但 tracking 仍然生效——中文「立即注册」在 0.14em 字距下同样读得出仪式感。
 */
const variants: Record<ButtonVariant, string> = {
  primary: "gilt foil-sheen font-semibold",
  secondary:
    "border border-border-hover bg-bg-tertiary text-text-primary hover:border-border-strong hover:bg-bg-hover",
  outline:
    "border border-gold/50 text-gold hover:border-gold hover:bg-gold/[0.07] active:bg-gold/10",
  ghost: "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
  danger: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
  green: "border border-success/30 bg-success/15 text-success hover:bg-success/25 font-semibold",
  red: "border border-danger/30 bg-danger/15 text-danger hover:bg-danger/25 font-semibold",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[11px] tracking-[0.06em] rounded-sm",
  md: "h-11 px-6 text-xs uppercase tracking-[0.14em] rounded-sm",
  lg: "h-14 px-9 text-[13px] uppercase tracking-[0.18em] rounded-sm",
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
          "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-300 ease-out",
          "tap-44",
          "active:translate-y-px active:duration-75",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0",
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="opacity-80" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
