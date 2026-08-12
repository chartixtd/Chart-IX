import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    // id 是可选的，但错误/提示文本要能被读屏关联上就必须有一个稳定 id。
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;

    return (
      <div className="w-full space-y-2">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium uppercase tracking-wider text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "w-full rounded-sm border bg-bg-tertiary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200",
            "shadow-[inset_0_1px_0_rgba(0,0,0,0.35)]",
            "focus:outline-none focus:ring-1 focus:ring-gold/60 focus:border-gold focus:animate-ring-expand",
            error
              ? "border-danger/50 focus:ring-danger/50 focus:border-danger"
              : "border-border-default hover:border-border-hover",
            className
          )}
          {...props}
        />
        {hint && !error && (
          <p id={hintId} className="text-xs text-text-muted">
            {hint}
          </p>
        )}
        {/* role="alert" 让错误在出现时被读屏播报，而不是等用户 Tab 回来才发现 */}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
