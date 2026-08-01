"use client";

import { useState } from "react";
import { useChartStore, DRAWING_TOOLS, type DrawingTool } from "@/stores/chartStore";
import { ColorPicker } from "./ColorPicker";
import { cn } from "@/lib/utils";

const ICON: Record<DrawingTool, React.ReactNode> = {
  trendline: <path d="M3 17L17 5" />,
  ray: <><path d="M3 17L16 6" /><path d="M11 5h6v6" /></>,
  hline: <path d="M2 10h16" />,
  vline: <path d="M10 2v16" />,
  rect: <rect x="3" y="5" width="14" height="10" rx="1" />,
  fib: <><path d="M2 4h16" /><path d="M2 8h16" /><path d="M2 12h16" /><path d="M2 16h16" /></>,
  text: <><path d="M4 4h12" /><path d="M10 4v12" /></>,
  channel: <><path d="M2 15L17 4" /><path d="M3 17L18 6" /></>,
  "fib-extension": <><path d="M2 4h16" /><path d="M2 10h16" /><path d="M2 16h16" /><path d="M2 2L18 18" strokeDasharray="1.5 1.5" /></>,
  "fib-fan": <><path d="M2 18L18 2" /><path d="M2 18L18 8" /><path d="M2 18L18 14" /></>,
  circle: <circle cx="10" cy="10" r="7" />,
  triangle: <path d="M10 3l7 14H3z" />,
  arrow: <><path d="M3 17L17 3" /><path d="M8 3h9v9" /></>,
  "price-range": <><path d="M4 3v14" /><path d="M16 3v14" /><path d="M4 10h12" /></>,
  "date-range": <><path d="M3 4h14" /><path d="M3 16h14" /><path d="M10 4v12" /></>,
};

export function DrawingToolbar({ symbol }: { symbol: string }) {
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const drawingColor = useChartStore((s) => s.drawingColor);
  const setDrawingColor = useChartStore((s) => s.setDrawingColor);
  const keepToolActive = useChartStore((s) => s.keepToolActive);
  const setKeepToolActive = useChartStore((s) => s.setKeepToolActive);
  const selectedDrawingId = useChartStore((s) => s.selectedDrawingId);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const clearDrawings = useChartStore((s) => s.clearDrawings);
  const count = useChartStore((s) => s.drawings[symbol]?.length ?? 0);

  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-border-default bg-bg-secondary/40 py-2">
      {/* Cursor / deselect */}
      <button
        onClick={() => setActiveTool(null)}
        title="选择工具（Esc）"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xs transition-colors",
          activeTool === null ? "bg-gold/20 text-gold" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
        )}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 3l11 7-5 1-1.5 5z" />
        </svg>
      </button>

      <div className="my-1 h-px w-5 bg-border-default" />

      {DRAWING_TOOLS.map(({ tool, label }) => (
        <button
          key={tool}
          onClick={() => setActiveTool(activeTool === tool ? null : tool)}
          title={label}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-xs transition-colors",
            activeTool === tool ? "bg-gold/20 text-gold" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
          )}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {ICON[tool]}
          </svg>
        </button>
      ))}

      <div className="my-1 h-px w-5 bg-border-default" />

      {/* Colour picker (free colour, not just fixed swatches) */}
      <div className="relative">
        <button
          onClick={() => setColorPopoverOpen((o) => !o)}
          title="线条颜色"
          className="flex h-7 w-7 items-center justify-center rounded-xs hover:bg-bg-tertiary"
        >
          <span className="h-3.5 w-3.5 rounded-full border border-text-primary/40" style={{ background: drawingColor }} />
        </button>
        {colorPopoverOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setColorPopoverOpen(false)} />
            <div className="absolute left-9 top-0 z-20 rounded-sm border border-border-default bg-bg-secondary p-2 shadow-modal">
              <ColorPicker value={drawingColor} onChange={setDrawingColor} />
            </div>
          </>
        )}
      </div>

      <div className="my-1 h-px w-5 bg-border-default" />

      {/* Pin tool (keep armed after each drawing) */}
      <button
        onClick={() => setKeepToolActive(!keepToolActive)}
        title={keepToolActive ? "连续绘制：开（画完保持工具）" : "连续绘制：关（画完回到选择）"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xs text-[13px] transition-colors",
          keepToolActive ? "bg-gold/20 text-gold" : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
        )}
      >
        📌
      </button>

      {/* Delete selected */}
      <button
        onClick={() => selectedDrawingId && removeDrawing(symbol, selectedDrawingId)}
        disabled={!selectedDrawingId}
        title="删除选中图形（Delete）"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xs transition-colors",
          selectedDrawingId
            ? "text-text-muted hover:bg-bg-tertiary hover:text-danger"
            : "cursor-not-allowed text-text-muted/30"
        )}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
        </svg>
      </button>

      {/* Clear all for this symbol */}
      <button
        onClick={() => { if (count > 0) clearDrawings(symbol); }}
        disabled={count === 0}
        title={`清空本交易对全部图形（${count}）`}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-xs text-[10px] font-medium transition-colors",
          count > 0
            ? "text-text-muted hover:bg-bg-tertiary hover:text-danger"
            : "cursor-not-allowed text-text-muted/30"
        )}
      >
        清空
      </button>
    </div>
  );
}
