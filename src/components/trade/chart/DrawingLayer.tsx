"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import {
  useChartStore,
  type Drawing,
  type DrawingPoint,
  type DrawingTool,
  DEFAULT_DRAWING_LINE_WIDTH,
  DEFAULT_DRAWING_LINE_STYLE,
  DEFAULT_DRAWING_OPACITY,
  DEFAULT_DRAWING_FONT_SIZE,
} from "@/stores/chartStore";
import { timeToLogical, logicalToTime, snapToBar } from "@/lib/chart/coords";
import { CHART, MONO_FONT } from "@/lib/chart-theme";
import { DrawingSettingsModal } from "./DrawingSettingsModal";

/** Tools that commit on a single click; the rest need a press-drag-release. */
const ONE_POINT_TOOLS: ReadonlySet<DrawingTool> = new Set(["hline", "vline", "text"]);

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const FIB_EXTENSION_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];

const DASH_ARRAY: Record<Drawing["lineStyle"], string | undefined> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "1.5 3",
};


/** 触屏/手写笔没有双击，长按同样时长后打开样式面板。 */
const LONG_PRESS_MS = 500;
/** 长按判定的手指抖动容差（px）：超过就当成拖动，不再弹面板。 */
const LONG_PRESS_SLOP = 8;

/**
 * 只认主指针的主键按下：
 * - 右键/中键不该开始画图；
 * - macOS 的 Ctrl+左键是系统右键，同样要放过去；
 * - 双指缩放时的第二根手指 isPrimary=false，不能被当成第二笔拖动。
 */
function isPrimaryPointer(
  e: Pick<PointerEvent, "button" | "pointerType" | "ctrlKey" | "isPrimary">
): boolean {
  if (e.button !== 0) return false;
  if (e.pointerType === "mouse" && e.ctrlKey) return false;
  return e.isPrimary !== false;
}

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
  const t = useTranslations("trade.drawing");
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
  // Third-point pending state, only used by 3-point tools (currently: channel only)
  const [pendingChannel, setPendingChannel] = useState<{ a: DrawingPoint; b: DrawingPoint } | null>(null);
  // Pending text annotation awaiting input
  const [pendingText, setPendingText] = useState<DrawingPoint | null>(null);
  const [textValue, setTextValue] = useState("");
  // Drawing whose style settings modal is open (double-click, or long-press on touch)
  const [settingsDrawingId, setSettingsDrawingId] = useState<string | null>(null);
  // Whole-shape drag of an existing drawing
  const dragRef = useRef<{ id: string; origin: DrawingPoint; points: DrawingPoint[] } | null>(null);
  // Mirror of `draft` for the window-level pointer handlers, which capture the
  // render they were created in and would otherwise read a stale draft.
  const draftRef = useRef<{ tool: DrawingTool; a: DrawingPoint; b: DrawingPoint } | null>(null);
  // Cancels the in-flight pointer drag (see startSession). Null when idle.
  const sessionRef = useRef<(() => void) | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  // Latest-render pointerdown handler for the chart container. The listener
  // itself is attached once (below) and dispatches through this ref, so it can
  // read fresh props/state without re-binding on every render.
  const containerDownRef = useRef<((e: PointerEvent) => void) | null>(null);

  // Abandon any half-finished drag if the chart goes away mid-gesture.
  useEffect(() => () => sessionRef.current?.(), []);

  /**
   * 手机上手势的核心一条：工具处于选中状态时，图表本身仍然要能双指缩放。
   *
   * 原来的做法是在图表上盖一层全画布的透明 <rect> 吃掉指针事件，桌面端够用，
   * 手机上是死局——lightweight-charts 的平移/双指缩放全靠 touch 事件，而
   * touchstart 打在遮罩上就永远到不了它的 canvas，于是只要点开任何一个画线
   * 工具，K 线就彻底卡住：既不能拖动，也不能双指放大，只能先退出工具再看图。
   *
   * 改成关掉图表自己的"单指拖动平移"，遮罩整层撤掉：
   * - 一根手指 → 图表不再平移，事件照常冒泡到容器，由我们画线；
   * - 两根手指 → touchstart 直接落在图表 canvas 上，pinch 缩放照常工作；
   * - 滚轮/价格轴拖动 → 完全没被拦过，桌面端连带修好（以前遮罩把滚轮也吃了）。
   */
  useEffect(() => {
    if (!chart) return;
    chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: !activeTool,
        horzTouchDrag: !activeTool,
        vertTouchDrag: !activeTool,
      },
    });
  }, [chart, activeTool]);

  // 单指拖动交给我们之后，lightweight-charts 不再 preventDefault 触摸移动，
  // 浏览器会把这一下当成滚页面。touch-action:none 顶掉这个默认行为——双指缩放
  // 是库在 JS 里自己实现的，不依赖浏览器手势，所以关掉不影响。
  // 顺带禁掉 iOS 长按弹出的选择放大镜和文字选中。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const armed = Boolean(activeTool);
    const props = ["touch-action", "user-select", "-webkit-user-select", "-webkit-touch-callout"];
    if (armed) {
      el.style.setProperty("touch-action", "none");
      el.style.setProperty("user-select", "none");
      el.style.setProperty("-webkit-user-select", "none");
      el.style.setProperty("-webkit-touch-callout", "none");
    }
    el.style.cursor = armed ? "crosshair" : "";
    return () => {
      for (const p of props) el.style.removeProperty(p);
      el.style.cursor = "";
    };
  }, [activeTool, containerRef]);

  // ---- Drawing starts on the chart container, not on an overlay ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => containerDownRef.current?.(e);
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [containerRef]);

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

  // ---- Leaving the channel tool (cursor button, switching tools) clears any pending third-point state ----
  useEffect(() => {
    if (activeTool !== "channel") {
      setPendingChannel(null);
      draftRef.current = null;
      setDraft(null);
    }
  }, [activeTool]);

  // ---- Esc cancels the armed tool / draft; Delete removes the selection ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        sessionRef.current?.();
        draftRef.current = null;
        setDraft(null);
        setPendingChannel(null);
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

  // 每次渲染先把容器上的按下处理器摘掉，就绪时再在下面挂回当前这版。
  // 少了这一步，切换品种、蜡烛短暂为空的那几帧里 listener 还指着上一版闭包，
  // 按下会用旧的 times 数组换算，图形落到错误的时间上。
  containerDownRef.current = null;

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

  /**
   * 一次指针拖拽 = 一组挂在 window 上的监听，而不是 setPointerCapture。
   *
   * 两个原因，都和"换个系统就用不了"直接相关：
   * 1. WebKit（macOS / iOS Safari）对 SVG 元素的 setPointerCapture 支持不可靠，
   *    调用可能抛错，也可能静默失败——一旦失败，指针移出图形本身就再也收不到
   *    move，线只画一半就断了；
   * 2. 就算捕获成功，指针拖出画布外（Windows 上多显示器之间尤其容易）时的
   *    up 事件也会丢，图形会一直粘在鼠标上。
   * 挂 window 在所有系统上行为一致，顺带天然覆盖 pointercancel（触屏被系统
   * 手势打断、笔离开数位板）。
   */
  const startSession = (
    pointerId: number,
    onMove: (e: PointerEvent) => void,
    onEnd: (e: PointerEvent | null) => void
  ) => {
    sessionRef.current?.(); // 上一笔没收尾就先收掉，避免两组监听叠在一起
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) onMove(ev);
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      sessionRef.current = null;
    };
    const finish = (ev: PointerEvent | null) => {
      detach();
      onEnd(ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(ev);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    sessionRef.current = () => finish(null);
  };

  const applyDraft = (d: { tool: DrawingTool; a: DrawingPoint; b: DrawingPoint } | null) => {
    draftRef.current = d;
    setDraft(d);
  };

  // ---- Draft / creation handlers (capture rect, only while a tool is armed) ----
  const finishDraft = (end: DrawingPoint | null) => {
    const d = draftRef.current;
    applyDraft(null);
    if (!d) return;
    const p = end ?? d.b;
    // Ignore accidental click-without-drag so a stray click leaves no zero-size shape
    const moved = p.time !== d.a.time || p.price !== d.a.price;
    if (moved) {
      if (d.tool === "channel") {
        setPendingChannel({ a: d.a, b: p });
        return; // wait for the third click (channel offset) instead of finishing here
      }
      addDrawing(symbol, { tool: d.tool, points: [d.a, p], color: drawingColor });
    }
    if (!keepToolActive) setActiveTool(null);
  };

  /** 按下点是否落在价格窗格内——落在价格轴/时间轴上的要留给图表自己缩放。 */
  const isInsidePane = (e: { clientX: number; clientY: number }): boolean => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return x >= 0 && y >= 0 && x <= W && y <= H;
  };

  const onContainerPointerDown = (e: PointerEvent) => {
    if (!activeTool) {
      // 手机上没有"点空白处取消选中"的键盘替代，点图表空白即取消选中。
      // 图形本身在上层 SVG 里，点它不会走到这儿，所以不会误伤。
      if (selectedId && isInsidePane(e)) setSelected(null);
      return;
    }
    // 第二根手指落下 = 用户要双指缩放：丢掉这半笔，把手势整个让给图表。
    // 不能走 finishDraft 的正常收尾，否则会把捏合的起手势提交成一个图形。
    if (e.isPrimary === false) {
      draftRef.current = null;
      sessionRef.current?.();
      return;
    }
    if (!isPrimaryPointer(e) || !isInsidePane(e)) return;
    const p = pointFromEvent(e);
    if (!p) return;

    if (pendingChannel) {
      addDrawing(symbol, {
        tool: "channel",
        points: [pendingChannel.a, pendingChannel.b, p],
        color: drawingColor,
      });
      setPendingChannel(null);
      if (!keepToolActive) setActiveTool(null);
      return;
    }

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

    applyDraft({ tool: activeTool, a: p, b: p });
    startSession(
      e.pointerId,
      (ev) => {
        const q = pointFromEvent(ev);
        const d = draftRef.current;
        if (q && d) applyDraft({ ...d, b: q });
      },
      (ev) => finishDraft(ev ? pointFromEvent(ev) : null)
    );
  };

  // Publish the current render's handler to the listener attached above.
  containerDownRef.current = onContainerPointerDown;

  // ---- Moving an existing drawing (select tool only) ----
  const onShapePointerDown = (e: ReactPointerEvent<SVGElement>, d: Drawing) => {
    if (activeTool) return; // creating, not selecting
    if (!isPrimaryPointer(e)) return;
    e.stopPropagation();
    setSelected(d.id);
    const p = pointFromEvent(e);
    if (!p) return;
    dragRef.current = { id: d.id, origin: p, points: d.points };

    const startX = e.clientX;
    const startY = e.clientY;
    // 触屏/手写笔没有双击事件，用长按代替"双击打开样式面板"
    let longPress: number | null = null;
    if (e.pointerType !== "mouse") {
      longPress = window.setTimeout(() => {
        longPress = null;
        dragRef.current = null;
        sessionRef.current?.();
        setSettingsDrawingId(d.id);
      }, LONG_PRESS_MS);
    }
    const clearLongPress = () => {
      if (longPress !== null) {
        clearTimeout(longPress);
        longPress = null;
      }
    };

    startSession(
      e.pointerId,
      (ev) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (longPress !== null) {
          const slipped =
            Math.abs(ev.clientX - startX) > LONG_PRESS_SLOP ||
            Math.abs(ev.clientY - startY) > LONG_PRESS_SLOP;
          if (!slipped) return; // 还在长按判定里，先别动图形
          clearLongPress();
        }
        const q = pointFromEvent(ev);
        if (!q) return;
        const dt = q.time - drag.origin.time;
        const dp = q.price - drag.origin.price;
        updateDrawing(symbol, drag.id, {
          points: drag.points.map((pt) => ({ time: pt.time + dt, price: pt.price + dp })),
        });
      },
      () => {
        clearLongPress();
        dragRef.current = null;
      }
    );
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
    // 拖拽/双击的公共接线。move 与 up 走 window（见 startSession），这里只留按下。
    // touchAction:none 是触屏上能拖动的前提——否则浏览器会把这一下判成滚动手势，
    // 直接发 pointercancel 把拖动掐掉。
    const grab = {
      onPointerDown: (e: ReactPointerEvent<SVGElement>) => onShapePointerDown(e, d),
      onDoubleClick: () => setSettingsDrawingId(d.id),
    };
    const grabStyle = (mode: "stroke" | "all") =>
      ({
        pointerEvents: (activeTool ? "none" : mode) as "none" | "stroke" | "all",
        cursor: "move",
        touchAction: "none",
      }) as const;

    // A fat transparent copy under each shape makes thin lines easy to grab.
    const hit = {
      stroke: "transparent",
      // 触屏手指的命中半径远大于鼠标；12px 在手机上基本点不中细线
      strokeWidth: 16,
      fill: "none",
      style: grabStyle("stroke"),
      ...grab,
    };

    const [a, b] = d.points;

    if (d.tool === "hline") {
      const y = yOf(a.price);
      if (y === null) return null;
      return (
        <g key={d.id}>
          <line x1={0} y1={y} x2={W} y2={y} {...hit} />
          <line x1={0} y1={y} x2={W} y2={y} {...common} />
          <text x={4} y={y - 4} fill={stroke} fontSize={10} fontFamily={MONO_FONT}>
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
      const fontSize = d.fontSize ?? DEFAULT_DRAWING_FONT_SIZE;
      return (
        <g key={d.id}>
          <text
            x={x}
            y={y}
            fill={stroke}
            fontSize={fontSize}
            style={grabStyle("all")}
            {...grab}
          >
            {d.text || t("text_placeholder")}
          </text>
          {sel && (
            <rect
              x={x - 3}
              y={y - fontSize - 1}
              width={(d.text?.length || 2) * fontSize * 0.67 + 8}
              height={fontSize + 6}
              fill="none"
              stroke={stroke}
              strokeDasharray="3 2"
              strokeWidth={1}
            />
          )}
        </g>
      );
    }

    if (d.tool === "channel") {
      const [pa, pb, pc] = d.points;
      if (!pb) return null;
      const ax = xOf(pa.time), ay = yOf(pa.price);
      const bx = xOf(pb.time), by = yOf(pb.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      // Offset line: parallel to A-B, passing through the third point (or a small default offset while pending).
      const offsetPrice = pc ? pc.price - (pa.price + ((pb.price - pa.price) * (pc.time - pa.time)) / (pb.time - pa.time || 1)) : 0;
      const cy1 = yOf(pa.price + offsetPrice);
      const cy2 = yOf(pb.price + offsetPrice);
      if (cy1 === null || cy2 === null) return null;
      return (
        <g key={d.id}>
          <polygon
            points={`${ax},${ay} ${bx},${by} ${bx},${cy2} ${ax},${cy1}`}
            fill={stroke}
            fillOpacity={d.opacity}
          />
          <line x1={ax} y1={ay} x2={bx} y2={by} {...hit} />
          <line x1={ax} y1={ay} x2={bx} y2={by} {...common} />
          <line x1={ax} y1={cy1} x2={bx} y2={cy2} {...common} />
          <line x1={ax} y1={ay} x2={ax} y2={cy1} stroke={stroke} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2 3" />
          {sel && (
            <>
              <circle cx={ax} cy={ay} r={3.5} fill={stroke} />
              <circle cx={bx} cy={by} r={3.5} fill={stroke} />
              <circle cx={ax} cy={cy1} r={3.5} fill={stroke} />
            </>
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
            strokeWidth={16}
            style={grabStyle("all")}
            {...grab}
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

    if (d.tool === "circle") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      return (
        <g key={d.id}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={stroke} fillOpacity={d.opacity} stroke="transparent" strokeWidth={16}
            style={grabStyle("all")} {...grab} />
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} fill={stroke} fillOpacity={d.opacity} />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "triangle") {
      const points = `${(x1 + x2) / 2},${Math.min(y1, y2)} ${x1},${Math.max(y1, y2)} ${x2},${Math.max(y1, y2)}`;
      return (
        <g key={d.id}>
          <polygon points={points} fill={stroke} fillOpacity={d.opacity} stroke="transparent" strokeWidth={16}
            style={grabStyle("all")} {...grab} />
          <polygon points={points} {...common} fill={stroke} fillOpacity={d.opacity} />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10;
      const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <polyline points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`} fill="none" stroke={stroke} strokeWidth={common.strokeWidth} vectorEffect="non-scaling-stroke" />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "price-range") {
      const deltaPrice = b.price - a.price;
      const deltaPct = a.price !== 0 ? (deltaPrice / a.price) * 100 : 0;
      const midY = (y1 + y2) / 2;
      const up = deltaPrice >= 0;
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x1} y2={y2} {...hit} />
          <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
            fill={up ? CHART.up : CHART.down} fillOpacity={0.1} stroke="transparent" strokeWidth={0} />
          <line x1={x1} y1={y1} x2={x1} y2={y2} stroke={stroke} strokeWidth={common.strokeWidth} strokeDasharray={DASH_ARRAY[d.lineStyle]} vectorEffect="non-scaling-stroke" />
          <text x={Math.min(x1, x2) + 4} y={midY} fill={up ? CHART.up : CHART.down} fontSize={11} fontFamily={MONO_FONT} fontWeight={600}>
            {deltaPrice >= 0 ? "+" : ""}{deltaPrice.toPrecision(6)} ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%)
          </text>
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x1} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "date-range") {
      const deltaSeconds = Math.abs(b.time - a.time);
      const bars = times.filter((t) => t >= Math.min(a.time, b.time) && t <= Math.max(a.time, b.time)).length;
      const midX = (x1 + x2) / 2;
      const label = deltaSeconds >= 86400
        ? t("duration_days", { days: (deltaSeconds / 86400).toFixed(1), bars })
        : t("duration_hours", { hours: (deltaSeconds / 3600).toFixed(1), bars });
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y1} {...hit} />
          <line x1={x1} y1={y1} x2={x2} y2={y1} stroke={stroke} strokeWidth={common.strokeWidth} strokeDasharray={DASH_ARRAY[d.lineStyle]} vectorEffect="non-scaling-stroke" />
          <text x={midX} y={y1 - 6} fill={stroke} fontSize={11} fontFamily={MONO_FONT} fontWeight={600} textAnchor="middle">
            {label}
          </text>
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y1} r={3.5} fill={stroke} /></>}
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
                  strokeWidth={sel ? d.lineWidth + 0.5 : d.lineWidth}
                  strokeOpacity={lvl === 0 || lvl === 1 ? 0.9 : 0.55}
                  strokeDasharray={lvl === 0 || lvl === 1 ? DASH_ARRAY[d.lineStyle] : "3 3"}
                />
                <text x={lo + 2} y={y - 3} fill={stroke} fontSize={9} fontFamily={MONO_FONT} opacity={0.85}>
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
            strokeWidth={d.lineWidth}
            strokeOpacity={0.4}
            strokeDasharray={DASH_ARRAY[d.lineStyle]}
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

    if (d.tool === "fib-extension") {
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          {FIB_EXTENSION_LEVELS.map((lvl) => {
            const price = a.price + (b.price - a.price) * lvl;
            const y = yOf(price);
            if (y === null) return null;
            return (
              <g key={lvl}>
                <line
                  x1={lo} y1={y} x2={hi} y2={y}
                  stroke={stroke}
                  strokeWidth={sel ? d.lineWidth + 0.5 : d.lineWidth}
                  strokeOpacity={lvl === 0 || lvl === 1 ? 0.9 : 0.55}
                  strokeDasharray={lvl === 0 || lvl === 1 ? DASH_ARRAY[d.lineStyle] : "3 3"}
                />
                <text x={lo + 2} y={y - 3} fill={stroke} fontSize={9} fontFamily={MONO_FONT} opacity={0.85}>
                  {(lvl * 100).toFixed(1)}% {price.toPrecision(6)}
                </text>
              </g>
            );
          })}
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "fib-fan") {
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          {FIB_LEVELS.filter((l) => l > 0).map((lvl) => {
            const targetPrice = a.price + (b.price - a.price) * lvl;
            const ty = yOf(targetPrice);
            if (ty === null) return null;
            const rdx = x2 - x1;
            const rdy = ty - y1;
            const rlen = Math.hypot(rdx, rdy) || 1;
            const rscale = (W + H) / rlen;
            return (
              <line
                key={lvl}
                x1={x1} y1={y1}
                x2={x1 + rdx * rscale} y2={y1 + rdy * rscale}
                stroke={stroke}
                strokeWidth={sel ? d.lineWidth + 0.5 : d.lineWidth}
                strokeOpacity={0.6}
                strokeDasharray={DASH_ARRAY[d.lineStyle]}
              />
            );
          })}
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
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
        data-allow-zoom
        width={W}
        height={H}
        className="absolute left-0 top-0 z-[5]"
        style={{
          pointerEvents: "none",
          overflow: "hidden",
          // Safari 对 SVG 子元素上的 touch-action 支持不全，挂在 <svg> 上更稳。
          // 本身 pointerEvents:none，命中的永远是下面那些子元素，这条只影响它们。
          touchAction: "none",
          // 拖动图形时不要顺手把页面文字选中（Firefox / Linux 上最明显）
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* 这里没有"捕获层"。画线的按下事件挂在图表容器上（见上方 effect），
            图表的 canvas 因此始终能收到 touch 事件，双指缩放不受影响。 */}
        {(drawings ?? []).map((d) => renderShape(d))}
        {draft &&
          renderShape(
            {
              id: "__draft__",
              tool: draft.tool,
              points: [draft.a, draft.b],
              color: drawingColor,
              lineWidth: DEFAULT_DRAWING_LINE_WIDTH,
              lineStyle: DEFAULT_DRAWING_LINE_STYLE,
              opacity: DEFAULT_DRAWING_OPACITY,
            },
            true
          )}
        {pendingChannel && (
          <line
            x1={xOf(pendingChannel.a.time) ?? 0}
            y1={yOf(pendingChannel.a.price) ?? 0}
            x2={xOf(pendingChannel.b.time) ?? 0}
            y2={yOf(pendingChannel.b.price) ?? 0}
            stroke={drawingColor}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
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
          placeholder={t("text_input_placeholder")}
          className="absolute z-10 w-40 rounded-xs border border-gold bg-bg-secondary px-1.5 py-0.5 text-xs text-text-primary focus:outline-none"
          style={{ left: textX, top: Math.max(0, textY - 22) }}
        />
      )}

      {settingsDrawingId && (() => {
        const d = (drawings ?? []).find((dr) => dr.id === settingsDrawingId);
        return d ? (
          <DrawingSettingsModal symbol={symbol} drawing={d} onClose={() => setSettingsDrawingId(null)} />
        ) : null;
      })()}
    </>
  );
}
