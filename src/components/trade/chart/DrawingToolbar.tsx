"use client";

import { useChartStore, DRAWING_COLORS, type DrawingTool } from "@/stores/chartStore";
import { cn } from "@/lib/utils";

const ICON: Record<DrawingTool, React.ReactNode> = {
  trendline: <path d="M3 17L17 5" />,
  ray: <><path d="M3 17L16 6" /><path d="M11 5h6v6" /></>,
  hline: <path d="M2 10h16" />,
  vline: <path d="M10 2v16" />,
  rect: <rect x="3" y="5" width="14" height="10" rx="1" />,
  fib: <><path d="M2 4h16" /><path d="M2 8h16" /><path d="M2 12h16" /><path d="M2 16h16" /></>,
  text: <><path d="M4 4h12" /><path d="M10 4v12" /></>,
};

const TOOLS: { tool: DrawingTool; label: string }[] = [
  { tool: "trendline", label: "趋势线" },
  { tool: "ray", label: "射线" },
  { tool: "hline", label: "水平线" },
  { tool: "vline", label: "垂直线" },
  { tool: "rect", label: "矩形" },
  { tool: "fib", label: "斐波那契回撤" },
  { tool: "text", label: "文字标注" },
];

export function DrawingToolbar({ symbol }: { symbol: string }) {
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

      {TOOLS.map(({ tool, label }) => (
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

      {/* Colour swatches */}
      <div className="grid grid-cols-2 gap-0.5 px-1">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setDrawingColor(c)}
            title="线条颜色"
            className={cn(
              "h-3 w-3 rounded-full border transition-transform",
              drawingColor === c ? "scale-125 border-text-primary" : "border-transparent"
            )}
            style={{ background: c }}
          />
        ))}
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
