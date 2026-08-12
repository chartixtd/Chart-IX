"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { ChartPriceLine } from "../KlineChart";
import { CHART, MONO_FONT } from "@/lib/chart-theme";

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
  // Mirrors dragPrice for the window-level pointerup handler, which closes over
  // the render it was created in and would otherwise commit a stale price.
  const dragPriceRef = useRef<number | null>(null);
  /** Cancels the in-flight drag listeners. Null when idle. */
  const sessionRef = useRef<(() => void) | null>(null);

  const keyOf = (l: ChartPriceLine) => `${l.title}:${l.editable?.kind ?? ""}`;

  // Drop a half-finished drag if the chart unmounts mid-gesture.
  useEffect(() => () => sessionRef.current?.(), []);

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

  const setPrice = (p: number | null) => {
    dragPriceRef.current = p;
    setDragPrice(p);
  };

  const finishDrag = (commit: boolean) => {
    const pending = pendingRef.current;
    const price = dragPriceRef.current;
    setDragKey(null);
    setPrice(null);
    pendingRef.current = null;
    if (commit && pending && price !== null && price > 0) {
      pending.commit(price);
    }
  };

  /**
   * 拖拽期间的 move/up 挂在 window 上，而不是用 setPointerCapture：
   * WebKit（macOS / iOS Safari）在 SVG 元素上捕获指针并不可靠，捕获失败后手指
   * 一离开那条细线就收不到事件，止盈止损线会拖不动或者卡住不放手；指针拖出
   * 画布外时的 up 同样会丢。挂 window 三个系统行为一致。
   */
  const onPointerDown = (e: ReactPointerEvent<SVGGElement>, line: ChartPriceLine) => {
    if (!line.editable) return;
    // 右键、中键、macOS 的 Ctrl+左键、双指缩放的第二根手指都不该开始拖动
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.pointerType === "mouse" && e.ctrlKey) return;
    e.stopPropagation();
    e.preventDefault();

    const key = keyOf(line);
    setDragKey(key);
    setPrice(line.price);
    pendingRef.current = { key, commit: line.editable.onDragEnd };

    const pointerId = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const price = priceFromY(ev.clientY - rect.top);
      if (price !== null && price > 0) setPrice(price);
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      sessionRef.current = null;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detach();
      finishDrag(true);
    };
    // 被系统手势/来电打断时不能把半路的价格当成用户意图提交上去
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detach();
      finishDrag(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    sessionRef.current = () => {
      detach();
      finishDrag(false);
    };
  };

  return (
    <svg
      ref={svgRef}
      width={pane.width}
      height={pane.height}
      className="absolute left-0 top-0 z-[6]"
      style={{
        overflow: "hidden",
        pointerEvents: "none",
        // 触屏上不加这条，按住线往下拖会被判成页面滚动手势并发出 pointercancel
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
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
            style={{ pointerEvents: "all", cursor: "row-resize", touchAction: "none" }}
            onPointerDown={(e) => onPointerDown(e, line)}
          >
            {/* Fat invisible hit area, easier to grab than the visible line.
                18px ≈ 手指能稳定按中的最小高度，鼠标本来就够用。 */}
            <line x1={0} y1={yNum} x2={pane.width} y2={yNum} stroke="transparent" strokeWidth={18} />
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
              fill={CHART.ink}
              fontSize={10}
              fontFamily={MONO_FONT}
              textAnchor="middle"
            >
              {price.toPrecision(6)}
            </text>
            {isDragging && (
              <text x={6} y={yNum - 4} fill={line.color} fontSize={10} fontFamily={MONO_FONT}>
                {line.title} → {price.toPrecision(6)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
