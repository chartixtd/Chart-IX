import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /**
   * box  = 墨面输入框（默认）。表单、后台、终端。
   * line = 只有底线的输入框。认证页与营销面的表单——留白与发丝线承担全部结构。
   */
  variant?: "box" | "line";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, variant = "box", ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="eyebrow mb-2.5 block">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "w-full text-text-primary placeholder:text-text-faint transition-colors duration-300",
            "focus:outline-none",
            variant === "box"
              ? [
                  "rounded-sm border bg-bg-primary px-3.5 py-2.5 text-sm",
                  "focus:border-gold focus:ring-1 focus:ring-gold/40",
                  error
                    ? "border-danger/60 focus:border-danger focus:ring-danger/40"
                    : "border-border-hover hover:border-border-strong",
                ]
              : [
                  // 底线输入框的焦点态必须同时改**颜色和粗细**：只把 1px 线
                  // 从灰变金，在一条头发丝上是个太弱的焦点指示（WCAG 2.4.11）。
                  // pb 少 1px 抵消加粗，行不会跳。
                  "border-b bg-transparent px-0 pt-1 text-base",
                  "focus:border-b-2 focus:border-gold focus:pb-[11px]",
                  error ? "border-danger/70 pb-3" : "border-border-strong pb-3 hover:border-text-faint",
                ],
            className
          )}
          {...props}
        />
        {hint && !error && (
          <p id={hintId} className="mt-2 text-xs leading-relaxed text-text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
