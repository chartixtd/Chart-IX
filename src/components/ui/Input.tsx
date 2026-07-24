import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    return (
      <div className="w-full space-y-2">
        {label && (
          <label
            htmlFor={id}
            className="block text-xs font-medium uppercase tracking-wider text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "w-full rounded-sm border bg-bg-tertiary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200",
            "focus:outline-none focus:ring-1 focus:ring-gold/60 focus:border-gold",
            error
              ? "border-danger/50 focus:ring-danger/50 focus:border-danger"
              : "border-border-default hover:border-border-hover",
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
