import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "green" | "red";
type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  // .foil = 9 段金箔渐变 + 斜面 inset。不要在这里叠任何 shadow-* 工具类：
  // utilities 层会整条覆盖掉 .foil 的 box-shadow，斜面一没金就退回成一块黄色。
  primary: "foil foil-sheen font-semibold hover:brightness-[1.06] active:brightness-95",
  secondary:
    "bg-bg-tertiary text-text-primary border border-border-default hover:bg-bg-hover hover:border-border-hover",
  outline:
    "border border-gold/60 text-gold hover:bg-gold/10 hover:border-gold active:bg-gold/15",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
  danger: "bg-danger/10 text-danger border border-danger/25 hover:bg-danger/20",
  green: "bg-success/12 text-success border border-success/25 hover:bg-success/20 font-semibold",
  red: "bg-danger/12 text-danger border border-danger/25 hover:bg-danger/20 font-semibold",
};

/**
 * 尺寸同时决定圆角族：sm/md 落在数据面（密集 UI、交易终端、后台），用锐利的
 * 2–6px；lg 落在内容面（营销 CTA、空状态），用圆润的 16px。全站 100 处 size="sm"
 * 都在密集布局里，这个映射不需要额外 API 就能把两族圆角分开。
 */
const sizes: Record<ButtonSize, string> = {
  sm: "px-3.5 py-1.5 text-xs rounded-sm",
  md: "px-5 py-2.5 text-sm rounded-md",
  lg: "px-8 py-4 text-base rounded-xl",
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
          // 触摸设备上把命中区补到 44px，视觉尺寸不变（见 globals.css 的 .tap-44）
          "tap-44",
          "active:scale-[0.97] active:duration-75",
          // 键盘可见焦点环。用 focus-visible 而非 focus，鼠标点击不会留下焦点框。
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
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
