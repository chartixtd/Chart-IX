import { cn } from "@/lib/utils";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * "sheet" 在手机上从底部滑出、占满宽度，lg 及以上退回居中弹窗。
   * 手机上居中弹窗要么够不着关闭按钮，要么被键盘顶掉一半。
   */
  variant?: "dialog" | "sheet";
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  // 给编辑器这类「要在里面干活」的弹窗用：512px 的 lg 放不下富文本编辑
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
}: ModalProps) {
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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full border border-border-default bg-bg-secondary shadow-modal",
          isSheet
            ? [
                // 底部 sheet：只有上方两角圆润，底部留出系统安全区
                "max-h-[88dvh] overflow-y-auto rounded-t-lg pb-safe-b animate-sheet-in",
                "lg:max-h-[85vh] lg:rounded-lg lg:pb-0 lg:animate-scale-in",
                sizeClasses[size],
              ]
            : [
                // 内容超出视口时面板自己滚动。少了这条，长内容会从居中位置往
                // 上下两头同时溢出，而 body 已被锁住滚动，顶部与底部就再也够不着。
                "max-h-[90dvh] overflow-y-auto rounded-lg animate-scale-in",
                sizeClasses[size],
              ],
          className
        )}
      >
        {isSheet && (
          // 拖拽把手：纯视觉提示，告诉用户这是可以往下拨走的表面
          <div className="flex justify-center pt-3 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-border-hover" />
          </div>
        )}

        {title && (
          <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
