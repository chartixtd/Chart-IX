"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from "lightweight-charts";
import { useChartStore, type Drawing, type DrawingPoint, type DrawingTool } from "@/stores/chartStore";
import { timeToLogical, logicalToTime, snapToBar } from "@/lib/chart/coords";

/** Tools that commit on a single click; the rest need a press-drag-release. */
const ONE_POINT_TOOLS: ReadonlySet<DrawingTool> = new Set(["hline", "vline", "text"]);

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const DASH_ARRAY: Record<Drawing["lineStyle"], string | undefined> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "1.5 3",
};

interface Props {
  symbol: string;
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  /** Bar open times in seconds, ascending — the basis for time↔pixel mapping. */
  times: number[];
  /** The chart's host element, observed so the overlay tracks pane geometry. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function DrawingLayer({ symbol, chart, series, times, containerRef }: Props) {
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const keepToolActive = useChartStore((s) => s.keepToolActive);
  const drawingColor = useChartStore((s) => s.drawingColor);
  const drawings = useChartStore((s) => s.drawings[symbol]);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const selectedId = useChartStore((s) => s.selectedDrawingId);
  const setSelected = useChartStore((s) => s.setSelectedDrawing);

  // Bumped whenever the chart moves or resizes, forcing a coordinate recompute.
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  // In-progress shape (press → drag → release)
  const [draft, setDraft] = useState<{ tool: DrawingTool; a: DrawingPoint; b: DrawingPoint } | null>(null);
  // Pending text annotation awaiting input
  const [pendingText, setPendingText] = useState<DrawingPoint | null>(null);
  const [textValue, setTextValue] = useState("");
  // Whole-shape drag of an existing drawing
  const dragRef = useRef<{ id: string; origin: DrawingPoint; points: DrawingPoint[] } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // ---- Re-render on pan/zoom and on container resize ----
  useEffect(() => {
    if (!chart) return;
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(bump);
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(bump) : null;
    if (el && ro) ro.observe(el);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(bump);
      ro?.disconnect();
    };
  }, [chart, containerRef]);

  // ---- Esc cancels the armed tool / draft; Delete removes the selection ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setDraft(null);
        setPendingText(null);
        setActiveTool(null);
        setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeDrawing(symbol, selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, symbol, removeDrawing, setActiveTool, setSelected]);

  if (!chart || !series || times.length === 0) return null;

  const ts = chart.timeScale();
  let pane: { width: number; height: number };
  try {
    pane = chart.paneSize(0);
  } catch {
    return null;
  }
  if (!pane.width || !pane.height) return null;

  // ---- Coordinate conversion ----
  const xOf = (time: number): number | null => {
    const c = ts.logicalToCoordinate(timeToLogical(times, time) as Logical);
    return c === null ? null : (c as number);
  };
  const yOf = (price: number): number | null => {
    const c = series.priceToCoordinate(price);
    return c === null ? null : (c as number);
  };
  const pointFromEvent = (e: { clientX: number; clientY: number }): DrawingPoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const logical = ts.coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (logical === null || price === null) return null;
    return { time: snapToBar(times, logicalToTime(times, logical as number)), price: price as number };
  };

  // ---- Draft / creation handlers (capture rect, only while a tool is armed) ----
  const onCapturePointerDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!activeTool) return;
    const p = pointFromEvent(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activeTool === "text") {
      setPendingText(p);
      setTextValue("");
      return;
    }
    if (ONE_POINT_TOOLS.has(activeTool)) {
      addDrawing(symbol, { tool: activeTool, points: [p], color: drawingColor });
      if (!keepToolActive) setActiveTool(null);
      return;
    }
    setDraft({ tool: activeTool, a: p, b: p });
  };

  const onCapturePointerMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!draft) return;
    const p = pointFromEvent(e);
    if (p) setDraft({ ...draft, b: p });
  };

  const onCapturePointerUp = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!draft) return;
    const p = pointFromEvent(e) ?? draft.b;
    // Ignore accidental click-without-drag so a stray click leaves no zero-size shape
    const moved = p.time !== draft.a.time || p.price !== draft.a.price;
    if (moved) {
      addDrawing(symbol, { tool: draft.tool, points: [draft.a, p], color: drawingColor });
    }
    setDraft(null);
    if (!keepToolActive) setActiveTool(null);
  };

  // ---- Moving an existing drawing (select tool only) ----
  const onShapePointerDown = (e: ReactPointerEvent<SVGElement>, d: Drawing) => {
    if (activeTool) return; // creating, not selecting
    e.stopPropagation();
    setSelected(d.id);
    const p = pointFromEvent(e);
    if (!p) return;
    dragRef.current = { id: d.id, origin: p, points: d.points };
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  };

  const onShapePointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointFromEvent(e);
    if (!p) return;
    const dt = p.time - drag.origin.time;
    const dp = p.price - drag.origin.price;
    updateDrawing(symbol, drag.id, {
      points: drag.points.map((pt) => ({ time: pt.time + dt, price: pt.price + dp })),
    });
  };

  const onShapePointerUp = () => {
    dragRef.current = null;
  };

  // ---- Rendering ----
  const W = pane.width;
  const H = pane.height;

  const renderShape = (d: Drawing, isDraft = false) => {
    const sel = !isDraft && selectedId === d.id;
    const stroke = d.color;
    const common = {
      stroke,
      strokeWidth: sel ? d.lineWidth + 0.5 : d.lineWidth,
      fill: "none",
      strokeDasharray: isDraft ? "4 3" : DASH_ARRAY[d.lineStyle],
      vectorEffect: "non-scaling-stroke" as const,
    };
    // A fat transparent copy under each shape makes thin lines easy to grab.
    const hit = {
      stroke: "transparent",
      strokeWidth: 12,
      fill: "none",
      style: { pointerEvents: (activeTool ? "none" : "stroke") as "none" | "stroke", cursor: "move" },
      onPointerDown: (e: ReactPointerEvent<SVGElement>) => onShapePointerDown(e, d),
      onPointerMove: onShapePointerMove,
      onPointerUp: onShapePointerUp,
    };

    const [a, b] = d.points;

    if (d.tool === "hline") {
      const y = yOf(a.price);
      if (y === null) return null;
      return (
        <g key={d.id}>
          <line x1={0} y1={y} x2={W} y2={y} {...hit} />
          <line x1={0} y1={y} x2={W} y2={y} {...common} />
          <text x={4} y={y - 4} fill={stroke} fontSize={10} fontFamily="monospace">
            {a.price.toPrecision(6)}
          </text>
          {sel && <circle cx={W / 2} cy={y} r={3} fill={stroke} />}
        </g>
      );
    }

    if (d.tool === "vline") {
      const x = xOf(a.time);
      if (x === null) return null;
      return (
        <g key={d.id}>
          <line x1={x} y1={0} x2={x} y2={H} {...hit} />
          <line x1={x} y1={0} x2={x} y2={H} {...common} />
          {sel && <circle cx={x} cy={H / 2} r={3} fill={stroke} />}
        </g>
      );
    }

    if (d.tool === "text") {
      const x = xOf(a.time);
      const y = yOf(a.price);
      if (x === null || y === null) return null;
      return (
        <g key={d.id}>
          <text
            x={x}
            y={y}
            fill={stroke}
            fontSize={12}
            style={{ pointerEvents: activeTool ? "none" : "all", cursor: "move" }}
            onPointerDown={(e) => onShapePointerDown(e, d)}
            onPointerMove={onShapePointerMove}
            onPointerUp={onShapePointerUp}
          >
            {d.text || "文字"}
          </text>
          {sel && (
            <rect
              x={x - 3}
              y={y - 13}
              width={(d.text?.length || 2) * 8 + 8}
              height={18}
              fill="none"
              stroke={stroke}
              strokeDasharray="3 2"
              strokeWidth={1}
            />
          )}
        </g>
      );
    }

    if (!b) return null;
    const x1 = xOf(a.time);
    const y1 = yOf(a.price);
    const x2 = xOf(b.time);
    const y2 = yOf(b.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    if (d.tool === "trendline") {
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          {sel && (
            <>
              <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
              <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
            </>
          )}
        </g>
      );
    }

    if (d.tool === "ray") {
      // Extend past the second point to the edge of the pane
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const scale = (W + H) / len;
      const ex = x1 + dx * scale;
      const ey = y1 + dy * scale;
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={ex} y2={ey} {...hit} />
          <line x1={x1} y1={y1} x2={ex} y2={ey} {...common} />
          {sel && (
            <>
              <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
              <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
            </>
          )}
        </g>
      );
    }

    if (d.tool === "rect") {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      return (
        <g key={d.id}>
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill={stroke}
            fillOpacity={d.opacity}
            stroke="transparent"
            strokeWidth={12}
            style={{
              pointerEvents: (activeTool ? "none" : "all") as "none" | "all",
              cursor: "move",
            }}
            onPointerDown={(e) => onShapePointerDown(e, d)}
            onPointerMove={onShapePointerMove}
            onPointerUp={onShapePointerUp}
          />
          <rect x={rx} y={ry} width={rw} height={rh} {...common} fill={stroke} fillOpacity={d.opacity} />
          {sel && (
            <>
              <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
              <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
            </>
          )}
        </g>
      );
    }

    if (d.tool === "fib") {
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      // Level 0 sits at the first point's price, level 1 at the second's
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          {FIB_LEVELS.map((lvl) => {
            const price = a.price + (b.price - a.price) * lvl;
            const y = yOf(price);
            if (y === null) return null;
            return (
              <g key={lvl}>
                <line
                  x1={lo}
                  y1={y}
                  x2={hi}
                  y2={y}
                  stroke={stroke}
                  strokeWidth={sel ? 1.5 : 1}
                  strokeOpacity={lvl === 0 || lvl === 1 ? 0.9 : 0.55}
                  strokeDasharray={lvl === 0 || lvl === 1 ? undefined : "3 3"}
                />
                <text x={lo + 2} y={y - 3} fill={stroke} fontSize={9} fontFamily="monospace" opacity={0.85}>
                  {(lvl * 100).toFixed(1)}% {price.toPrecision(6)}
                </text>
              </g>
            );
          })}
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="2 3"
          />
          {sel && (
            <>
              <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
              <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
            </>
          )}
        </g>
      );
    }

    return null;
  };

  const textX = pendingText ? xOf(pendingText.time) : null;
  const textY = pendingText ? yOf(pendingText.price) : null;

  return (
    <>
      <svg
        ref={svgRef}
        data-version={version}
        width={W}
        height={H}
        className="absolute left-0 top-0 z-[5]"
        style={{ pointerEvents: "none", overflow: "hidden" }}
      >
        {/* Capture layer: only present while a tool is armed, so panning stays free otherwise */}
        {activeTool && (
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            style={{ pointerEvents: "all", cursor: "crosshair" }}
            onPointerDown={onCapturePointerDown}
            onPointerMove={onCapturePointerMove}
            onPointerUp={onCapturePointerUp}
          />
        )}

        {(drawings ?? []).map((d) => renderShape(d))}
        {draft &&
          renderShape(
            {
              id: "__draft__",
              tool: draft.tool,
              points: [draft.a, draft.b],
              color: drawingColor,
              lineWidth: 2,
              lineStyle: "solid",
              opacity: 0.15,
            },
            true
          )}
      </svg>

      {/* Inline text entry for the annotation tool */}
      {pendingText && textX !== null && textY !== null && (
        <input
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => setPendingText(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = textValue.trim();
              if (v) {
                addDrawing(symbol, {
                  tool: "text",
                  points: [pendingText],
                  color: drawingColor,
                  text: v,
                });
              }
              setPendingText(null);
              if (!keepToolActive) setActiveTool(null);
            } else if (e.key === "Escape") {
              setPendingText(null);
            }
          }}
          placeholder="输入文字后回车"
          className="absolute z-10 w-40 rounded-xs border border-gold bg-bg-secondary px-1.5 py-0.5 text-xs text-text-primary focus:outline-none"
          style={{ left: textX, top: Math.max(0, textY - 22) }}
        />
      )}
    </>
  );
}
