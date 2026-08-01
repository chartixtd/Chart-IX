"use client";

import { cn } from "@/lib/utils";

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

interface LineStyleControlProps {
  width: 1 | 2 | 3 | 4;
  style: DrawingLineStyle;
  onWidthChange: (w: 1 | 2 | 3 | 4) => void;
  onStyleChange: (s: DrawingLineStyle) => void;
}

const WIDTHS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
const STYLES: { value: DrawingLineStyle; label: string; dasharray?: string }[] = [
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线", dasharray: "4 3" },
  { value: "dotted", label: "点线", dasharray: "1 2" },
];

export function LineStyleControl({ width, style, onWidthChange, onStyleChange }: LineStyleControlProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onWidthChange(w)}
            title={`${w}px`}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-xs border transition-colors",
              width === w ? "border-gold bg-gold/10" : "border-border-default hover:border-gold/40"
            )}
          >
            <svg width="16" height="8" viewBox="0 0 16 8">
              <line x1="1" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth={w} className="text-text-primary" />
            </svg>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStyleChange(s.value)}
            title={s.label}
            className={cn(
              "flex h-6 w-8 items-center justify-center rounded-xs border transition-colors",
              style === s.value ? "border-gold bg-gold/10" : "border-border-default hover:border-gold/40"
            )}
          >
            <svg width="20" height="8" viewBox="0 0 20 8">
              <line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" strokeWidth={1.5} strokeDasharray={s.dasharray} className="text-text-primary" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
