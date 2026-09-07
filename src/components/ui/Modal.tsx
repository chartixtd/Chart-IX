import { cn } from "@/lib/utils";
import { useEffect, useId, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * "sheet" 在手机上从底部滑出、占满宽度，lg 及以上退回居中弹窗。
   */
  variant?: "dialog" | "sheet";
  /**
   * 面板材质。默认 "glass"（墨玻璃）；终端等 Operate 面必须传 "panel"——
   * 那里零 backdrop-filter。
   */
  surface?: "glass" | "panel";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  size = "md",
  variant = "dialog",
  surface = "glass",
}: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const isSheet = variant === "sheet";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        isSheet ? "items-end justify-center lg:items-center lg:p-4" : "items-center justify-center p-4"
      )}
    >
      <div
        className={cn(
          "absolute inset-0 animate-fade-in bg-black/70",
          surface === "glass" && "backdrop-blur-sm"
        )}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          surface === "glass" ? "ink-glass" : "ink-raised",
          "relative z-10 w-full",
          isSheet
            ? [
                "max-h-[88dvh] animate-sheet-in overflow-y-auto rounded-t-2xl pb-safe-b",
                "lg:max-h-[85vh] lg:animate-scale-in lg:rounded-xl lg:pb-0",
                sizeClasses[size],
              ]
            : ["max-h-[90dvh] animate-scale-in overflow-y-auto rounded-xl", sizeClasses[size]],
          className
        )}
      >
        {isSheet && (
          <div className="flex justify-center pt-3 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-border-strong" />
          </div>
        )}

        {title && (
          <div className="flex items-center justify-between border-b border-border-default px-6 py-5">
            <h2 id={titleId} className="font-display text-lg font-medium tracking-tight text-text-primary">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-10 w-10 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
