"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { ChartPriceLine } from "../KlineChart";

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  lines: ChartPriceLine[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Draggable take-profit/stop-loss lines. Native lightweight-charts price
 * lines (`createPriceLine`) have no pointer interaction, so editable lines
 * render on their own SVG layer instead — non-editable lines (entry,
 * liquidation, limit orders) stay on the cheaper native path in KlineChart.
 */
export function OrderLineOverlay({ chart, series, lines, containerRef }: Props) {
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const svgRef = useRef<SVGSVGElement>(null);

  // While dragging, track the line by identity (price+title, stable enough
  // across re-renders since a line's title doesn't change mid-drag) and its
  // live draft price, so the dragged line renders from local state instead
  // of waiting on the server round-trip to move it.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragPrice, setDragPrice] = useState<number | null>(null);
  const pendingRef = useRef<{ key: string; commit: (price: number) => void } | null>(null);

  const keyOf = (l: ChartPriceLine) => `${l.title}:${l.editable?.kind ?? ""}`;

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

  if (!chart || !series) return null;
  const editableLines = lines.filter((l) => l.editable);
  if (editableLines.length === 0) return null;

  let pane: { width: number; height: number };
  try {
    pane = chart.paneSize(0);
  } catch {
    return null;
  }
  if (!pane.width || !pane.height) return null;

  const priceFromY = (y: number): number | null => {
    const p = series.coordinateToPrice(y);
    return p === null ? null : (p as number);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGGElement>, line: ChartPriceLine) => {
    if (!line.editable) return;
    e.stopPropagation();
    const key = keyOf(line);
    setDragKey(key);
    setDragPrice(line.price);
    pendingRef.current = { key, commit: line.editable.onDragEnd };
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    if (!dragKey) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const price = priceFromY(y);
    if (price !== null && price > 0) setDragPrice(price);
  };

  const finishDrag = () => {
    const pending = pendingRef.current;
    const price = dragPrice;
    setDragKey(null);
    setDragPrice(null);
    pendingRef.current = null;
    if (pending && price !== null && price > 0) {
      pending.commit(price);
    }
  };

  return (
    <svg
      ref={svgRef}
      width={pane.width}
      height={pane.height}
      className="absolute left-0 top-0 z-[6]"
      style={{ overflow: "hidden", pointerEvents: "none" }}
    >
      {editableLines.map((line) => {
        const key = keyOf(line);
        const isDragging = dragKey === key;
        const price = isDragging && dragPrice !== null ? dragPrice : line.price;
        const y = series.priceToCoordinate(price);
        if (y === null) return null;
        const yNum = y as number;

        return (
          <g
            key={key}
            style={{ pointerEvents: "all", cursor: "row-resize" }}
            onPointerDown={(e) => onPointerDown(e, line)}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            {/* Fat invisible hit area, easier to grab than the visible line */}
            <line x1={0} y1={yNum} x2={pane.width} y2={yNum} stroke="transparent" strokeWidth={14} />
            <line
              x1={0}
              y1={yNum}
              x2={pane.width}
              y2={yNum}
              stroke={line.color}
              strokeWidth={isDragging ? 2 : 1.5}
              strokeDasharray={line.dashed ? "5 3" : undefined}
              opacity={isDragging ? 1 : 0.9}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={pane.width - 78}
              y={yNum - 9}
              width={76}
              height={18}
              fill={line.color}
              opacity={isDragging ? 1 : 0.85}
              rx={2}
            />
            <text
              x={pane.width - 40}
              y={yNum + 4}
              fill="#0b0a08"
              fontSize={10}
              fontFamily="monospace"
              textAnchor="middle"
            >
              {price.toPrecision(6)}
            </text>
            {isDragging && (
              <text x={6} y={yNum - 4} fill={line.color} fontSize={10} fontFamily="monospace">
                {line.title} → {price.toPrecision(6)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
