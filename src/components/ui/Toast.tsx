"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// 颜色不是唯一线索——每种类型都配一个图标，色盲用户与静音截图里同样读得出状态
const colors: Record<ToastType, string> = {
  success: "border-success/30 text-success",
  error: "border-danger/30 text-danger",
  info: "border-border-hover text-text-primary",
};

function ToastIcon({ type }: { type: ToastType }) {
  const common = {
    className: "h-4 w-4 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (type === "success") {
    return (
      <svg {...common}>
        <path d="m4 12.5 5 5L20 6.5" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.2v.3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </svg>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const toast = useCallback(
    (message: string, type?: ToastType) => addToast(message, type),
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* aria-live="polite" 让读屏播报内容但不抢焦点——用户正在做的事不该被打断。
          容器常驻而非随 toast 挂载，否则读屏可能整条错过后插入的节点。 */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "obsidian-glass-sm pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm animate-slide-up",
              colors[t.type]
            )}
          >
            <ToastIcon type={t.type} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
