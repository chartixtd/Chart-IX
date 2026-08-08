"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
  type LogicalRange,
} from "lightweight-charts";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useKlineHistory } from "@/hooks/useKlineHistory";
import { useSymbolSpec } from "@/hooks/useSymbolSpec";
import { useMarketStore } from "@/stores/market";
import { useChartStore } from "@/stores/chartStore";
import { useAuth } from "@/components/auth/AuthProvider";
import { canUseAdvancedChart } from "@/lib/access";
import { INDICATOR_BY_ID, resolvePlotStyle, type IndicatorInput } from "@/lib/chart/indicator-registry";
import { classifyBarsUpdate, classifyTail, overlaySignature } from "@/lib/chart/incremental";
import { IndicatorModal } from "./chart/IndicatorModal";
import { ChartLegend } from "./chart/ChartLegend";
import { DrawingToolbar } from "./chart/DrawingToolbar";
import { DrawingLayer } from "./chart/DrawingLayer";
import { OrderLineOverlay } from "./chart/OrderLineOverlay";
import { cn } from "@/lib/utils";

/** 图表上的进出场箭头标记 */
export interface ChartTradeMarker {
  /** 成交时间（毫秒），会对齐到对应 K 线 */
  time: number;
  side: "buy" | "sell";
  /** 悬浮/箭头文字，例如 "开多 0.5" */
  text?: string;
}

/** 图表上的水平价格线（进场价 / 止盈 / 止损 / 强平价） */
export interface ChartPriceLine {
  price: number;
  color: string;
  title: string;
  /** 虚线用于止盈止损/强平，实线用于进场价 */
  dashed?: boolean;
  /**
   * 只有止盈/止损线才带这个字段：拖动结束后调用，由调用方（useChartOverlay）
   * 决定怎么落地——实盘期货走 amend 接口，实盘现货走撤单重下，模拟盘直接更新
   * 持仓行。不带这个字段的线（进场价/强平价/普通挂单）保持原生只读价格线。
   */
  editable?: {
    kind: "tp" | "sl";
    onDragEnd: (newPrice: number) => void;
  };
}

interface KlineChartProps {
  symbol: string;
  interval?: string;
  className?: string;
  /** K 线走哪个市场的接口取——现货符号在合约市场未必存在（如代币化商品/
   *  外汇/美股/指数，只在合约侧上架），选错市场会导致取不到数据。 */
  market?: string;
  /** 进出场成交标记 */
  tradeMarkers?: ChartTradeMarker[];
  /** 进场/止盈/止损/强平等价格线 */
  priceLines?: ChartPriceLine[];
}

/** interval → duration in seconds */
const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
};

const UP = "#22c55e";
const DOWN = "#ef4444";
const GUIDE_COLOR = "rgba(120,120,120,0.35)";

/** Per-instance series handles, so data updates don't need to recreate anything. */
interface InstanceSeries {
  plotKey: string;
  series: ISeriesApi<SeriesType>;
}

export function KlineChart({ symbol, interval = "1h", className, market = "spot", tradeMarkers, priceLines }: KlineChartProps) {
  const locale = useLocale();
  const t = useTranslations("trade.indicators");
  const chartRef = useRef<HTMLDivElement>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const priceLinesSigRef = useRef<string | null>(null);
  const markersSigRef = useRef<string | null>(null);
  const seriesMapRef = useRef<Map<string, InstanceSeries[]>>(new Map());
  const isFirstDataRef = useRef(true);
  // Bookkeeping for pagination stitching: lets the "candles data updated" effect
  // distinguish "an older page got prepended" from "symbol/interval changed" or
  // "latest-page poll refresh" — only the former needs the visible range shifted.
  const prevEarliestTimeRef = useRef<UTCTimestamp | null>(null);
  const prevBarCountRef = useRef(0);
  // The last poll's tail bar time — classifies tick vs. close independently of
  // count, since sliding-window pagination can keep count/earliest constant
  // across a real close (see classifyTail's doc comment).
  const prevLastTimeRef = useRef<number | null>(null);
  // Structural identity from the last full-path render — if either changes, the
  // incremental path must not be trusted and we fall back to full setData.
  const lastAppliedRef = useRef<typeof applied | null>(null);
  const lastAdvancedRef = useRef<boolean | null>(null);

  // Held in state (not just refs) so the drawing layer re-renders once they exist.
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [candleSeries, setCandleSeries] = useState<ISeriesApi<"Candlestick"> | null>(null);

  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Last candle state, kept in sync so ticker updates can mutate it live
  const lastCandleRef = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  // rAF throttling refs for live price updates
  const rafRef = useRef<number | null>(null);
  const pendingPriceRef = useRef<number | undefined>(undefined);

  const { candles: klines, isLoading, isLoadingMore, hasMore, loadMore, isPlaceholder, isError } = useKlineHistory(symbol, interval, market);
  // 取数失败或确实没有数据时，画布上留着的是 keepPreviousData 带过来的上一个
  // 品种的蜡烛（休市品种必然走到这条路径）。必须盖住，不能让用户把别的品种的
  // 走势当成当前品种的。
  const noData = !isLoading && (isError || (!isPlaceholder && !klines?.length));
  // 蜡烛系列的价格精度：lightweight-charts 不设 priceFormat 时默认
  // precision:2/minMove:0.01。BTC/黄金这种大额标的凑巧看不出问题，但外汇
  // （EUR/USD ~1.16，真实精度 5 位）、日元对（精度 3 位）、低价币这些标的的
  // K线会被这个默认值整体吃进同一个 0.01 网格——同一段时间内所有报价都四舍五入
  // 成同一个数，图表上就是一条看不出蜡烛的平线，正是这次要修的问题。
  const { data: spec } = useSymbolSpec(symbol, market === "futures" ? "futures" : "spot");
  // Latest-value refs: let the scroll-triggered pagination subscription avoid
  // resubscribing on every render (loadMore's identity changes as olderCandles
  // grows) — same pattern as appliedRef below.
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const loadMoreRef = useRef(loadMore);
  hasMoreRef.current = hasMore;
  isLoadingMoreRef.current = isLoadingMore;
  loadMoreRef.current = loadMore;
  // Mirrors isPlaceholder for the rAF ticker loop below, which can't take it as
  // an effect dependency without tearing down/rebuilding the rAF loop on every
  // placeholder flip — same pattern as the refs above.
  const isPlaceholderRef = useRef(isPlaceholder);
  isPlaceholderRef.current = isPlaceholder;
  // Live price from WebSocket ticker (drives the current candle in real time)
  const livePrice = useMarketStore((s) => {
    const t = s.tickers[symbol];
    return t ? Number(t.lastPrice) : undefined;
  });

  // 等级直接决定，不再经 feature_flags 绕一圈（那张表只有这一个 key 真被读过）。
  // auth.loading 期间 tier 还是 null，canUseAdvancedChart 会返回 false，所以沿用
  // accessLoading 抑制加载态下的 🔒 闪烁。
  const auth = useAuth();
  const accessLoading = auth.loading;
  const hasAdvancedChart = canUseAdvancedChart(auth.tier);

  const applied = useChartStore((s) => s.appliedIndicators);
  // Latest-value ref: lets the structure effect read the current instance list
  // without listing `applied` as a dependency, which would rebuild every series
  // and pane on each param edit or visibility toggle.
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const runV1Migration = useChartStore((s) => s.runV1MigrationIfNeeded);

  // Fold this device's pre-registry indicator settings in, once.
  useEffect(() => { runV1Migration(); }, [runV1Migration]);

  // Only volume is free; every other indicator (and the drawing tools) is Pro.
  const isAllowed = (defId: string) => hasAdvancedChart || defId === "volume";

  /** Changes only when instances are added/removed — param edits don't rebuild series. */
  const structureKey = useMemo(
    () => applied.map((a) => `${a.instanceId}:${a.defId}`).join("|"),
    [applied]
  );

  const bars = useMemo(() => {
    if (!klines?.length) return null;
    const valid = klines
      .filter(
        (k) =>
          k.openTime > 0 &&
          !isNaN(k.open) && !isNaN(k.high) && !isNaN(k.low) &&
          !isNaN(k.close) && !isNaN(k.volume)
      )
      .sort((a, b) => a.openTime - b.openTime);
    if (!valid.length) return null;
    return {
      times: valid.map((k) => (k.openTime / 1000) as UTCTimestamp),
      input: {
        open: valid.map((k) => k.open),
        high: valid.map((k) => k.high),
        low: valid.map((k) => k.low),
        close: valid.map((k) => k.close),
        volume: valid.map((k) => k.volume),
      } as IndicatorInput,
    };
  }, [klines]);

  const drawingTimes = useMemo(() => (bars ? bars.times.map((t) => t as number) : []), [bars]);

  // ---- Create chart once ----
  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#666666",
        panes: { separatorColor: "#2a2a2a", separatorHoverColor: "rgba(201,162,75,0.3)" },
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1a1a1a" },
        horzLines: { color: "#1a1a1a" },
      },
      crosshair: {
        vertLine: { color: "#3a3a3a", style: 2, width: 1 },
        horzLine: { color: "#3a3a3a", style: 2, width: 1 },
      },
      rightPriceScale: { borderColor: "#2a2a2a" },
      timeScale: {
        borderColor: "#2a2a2a",
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight,
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    markersPluginRef.current = createSeriesMarkers(candles, []);
    setChartApi(chart);
    setCandleSeries(candles);

    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight,
        });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      seriesMapRef.current.clear();
      markersPluginRef.current = null;
      priceLinesRef.current = [];
      priceLinesSigRef.current = null;
      markersSigRef.current = null;
      setChartApi(null);
      setCandleSeries(null);
      isFirstDataRef.current = true;
      lastCandleRef.current = null;
      lastAppliedRef.current = null;
      lastAdvancedRef.current = null;
      prevLastTimeRef.current = null;
    };
  }, []);

  // ---- Reset when symbol/interval changes ----
  useEffect(() => {
    isFirstDataRef.current = true;
    lastCandleRef.current = null;
    prevEarliestTimeRef.current = null;
    prevBarCountRef.current = 0;
    prevLastTimeRef.current = null;
  }, [symbol, interval]);

  // ---- Sync candle price precision with the symbol's real spec ----
  // 图表实例只创建一次（见上方 CandlestickSeries 初始化），priceFormat 必须在
  // symbol 切换、spec 加载完成后用 applyOptions 更新，而不是只在建图时设一次。
  // spec 未就绪前保留上一个 symbol 的 priceFormat 总比突然跳回默认的 2 位精度
  // 好——真正的风险只在 spec 尚未到达的极短窗口内，不会导致数据错误，只是
  // 展示上稍微滞后一帧。
  useEffect(() => {
    if (!candleSeries || !spec) return;
    const minMove = Math.pow(10, -spec.pricePrecision);
    candleSeries.applyOptions({
      priceFormat: { type: "price", precision: spec.pricePrecision, minMove },
    });
  }, [candleSeries, spec]);

  // ---- Build indicator series + panes from the applied list ----
  // Rebuilding wholesale on any add/remove keeps pane indices consistent, which
  // incremental removal can't guarantee since removePane() shifts them.
  useEffect(() => {
    if (!chartApi) return;

    for (const entries of seriesMapRef.current.values()) {
      for (const e of entries) {
        try { chartApi.removeSeries(e.series); } catch { /* already gone */ }
      }
    }
    seriesMapRef.current.clear();

    // Drop every pane but the price pane, highest index first.
    try {
      const panes = chartApi.panes();
      for (let i = panes.length - 1; i >= 1; i--) {
        try { chartApi.removePane(i); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    for (const a of appliedRef.current) {
      const def = INDICATOR_BY_ID.get(a.defId);
      if (!def) continue;

      let paneIndex = 0;
      if (def.placement === "pane") {
        try {
          paneIndex = chartApi.addPane().paneIndex();
        } catch {
          paneIndex = 0;
        }
      }

      const entries: InstanceSeries[] = [];
      for (const plot of def.plots) {
        const base = {
          priceLineVisible: false,
          lastValueVisible: false,
          visible: false, // the data effect turns it on
        };
        let series: ISeriesApi<SeriesType>;
        if (plot.kind === "histogram") {
          series = chartApi.addSeries(
            HistogramSeries,
            { ...base, color: plot.color, priceFormat: { type: "volume" } },
            paneIndex
          );
        } else if (plot.kind === "dots") {
          series = chartApi.addSeries(
            LineSeries,
            { ...base, color: plot.color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 },
            paneIndex
          );
        } else {
          series = chartApi.addSeries(
            LineSeries,
            {
              ...base,
              color: plot.color,
              lineWidth: plot.lineWidth ?? 1,
              lineStyle: plot.lineStyle ?? 0,
            },
            paneIndex
          );
        }
        entries.push({ plotKey: plot.key, series });
      }
      seriesMapRef.current.set(a.instanceId, entries);

      if (def.placement === "pane") {
        try {
          chartApi.priceScale("right", paneIndex).applyOptions({
            borderColor: "#2a2a2a",
            scaleMargins: { top: 0.15, bottom: 0.1 },
          });
        } catch { /* ignore */ }

        // Reference lines (RSI 30/70, MACD zero, …) live on the pane's first plot.
        // No cleanup bookkeeping needed: removeSeries disposes its price lines.
        const host = entries[0]?.series;
        if (host && def.guides?.length) {
          for (const g of def.guides) {
            try {
              host.createPriceLine({
                price: g,
                color: GUIDE_COLOR,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
                title: "",
              });
            } catch { /* ignore */ }
          }
        }
      }
    }

    // Give sub-panes a modest slice so the price pane keeps most of the height.
    try {
      const panes = chartApi.panes();
      if (panes.length > 1) {
        const total = chartRef.current?.clientHeight ?? 0;
        if (total > 0) {
          const each = Math.max(52, Math.min(120, Math.round((total * 0.42) / (panes.length - 1))));
          for (let i = 1; i < panes.length; i++) panes[i].setHeight(each);
        }
      }
    } catch { /* ignore */ }
    // Deliberately keyed on structureKey only — `applied` is read through a ref
    // so param edits update data in place instead of rebuilding the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, structureKey]);

  // ---- Candles + all indicator data ----
  useEffect(() => {
    if (!chartApi || !candleSeries || !bars) return;
    // Placeholder 帧完全不碰图表：旧 symbol 的蜡烛本来就还挂在 series 上，
    // 半透明遮罩已表达"过期"语义。跳过记账写入，保住 reset effect 留下的
    // null/0 状态，真实数据到达帧才能正确判 "full" 并触发 fitContent。
    if (isPlaceholder) return;
    const { times, input } = bars;

    const kind =
      applied !== lastAppliedRef.current || hasAdvancedChart !== lastAdvancedRef.current
        ? "full"
        : classifyBarsUpdate(
            { earliest: prevEarliestTimeRef.current, count: prevBarCountRef.current },
            times as unknown as number[]
          );

    if (kind === "tick" || kind === "append") {
      const lastIdx = times.length - 1;
      // classifyBarsUpdate's count diff isn't trustworthy on its own — sliding-
      // window pagination can keep count/earliest constant across a real close
      // (see classifyTail's doc comment) — so re-derive tick vs. close from the
      // actual tail timestamp instead of trusting `kind`.
      const tailKind = classifyTail(prevLastTimeRef.current, times[lastIdx] as unknown as number);

      if (tailKind !== "regressed") {
        // 收线时前一根的最终值也要落盘（轮询返回的收盘价可能与 rAF 实时价有微差）
        const idxs = tailKind === "advanced" ? [lastIdx - 1, lastIdx] : [lastIdx];
        let ok = true;

        try {
          for (const i of idxs) {
            if (i < 0) continue;
            // i < lastIdx writes an already-plotted historical point (the just-
            // closed candle's final values) — lightweight-charts' regular
            // update() throws if its time is behind the series' current last
            // time, which the live-ticker rAF loop can have already advanced
            // past (it opens a fresh bucket on wall-clock alone, ahead of what
            // the poll response has caught up to). historicalUpdate=true is the
            // legal way to replace an existing historical point.
            candleSeries.update(
              {
                time: times[i],
                open: input.open[i],
                high: input.high[i],
                low: input.low[i],
                close: input.close[i],
              },
              i < lastIdx
            );
          }
        } catch {
          ok = false;
        }

        if (ok) {
          try {
            for (const a of applied) {
              const def = INDICATOR_BY_ID.get(a.defId);
              const entries = seriesMapRef.current.get(a.instanceId);
              if (!def || !entries) continue;
              let out: Record<string, (number | null)[]>;
              try { out = def.compute(input, a.params); } catch { continue; }
              for (const e of entries) {
                const plot = def.plots.find((p) => p.key === e.plotKey);
                const values = out[e.plotKey];
                if (!plot || !values) continue;
                const resolvedStyle = resolvePlotStyle(def, a.styleOverrides, e.plotKey);
                for (const i of idxs) {
                  const v = values[i];
                  // series.update() 不能"删点":尾值为 null 就跳过。这依赖 registry
                  // 里所有指标的 null 输出是单调的(窗口预热型:只有前段可能是
                  // null,一旦有值就不会再变回 null)——不存在非 null→null 回退,
                  // 所以跳过等价于该点本来也不存在于序列里,和全量路径一致。
                  if (v === null || v === undefined || Number.isNaN(v)) continue;
                  if (plot.kind === "histogram") {
                    e.series.update(
                      {
                        time: times[i],
                        value: v,
                        color: plot.barColor ? plot.barColor({ i, value: v, input }) : resolvedStyle.color,
                      },
                      i < lastIdx
                    );
                  } else {
                    e.series.update({ time: times[i], value: v }, i < lastIdx);
                  }
                }
              }
            }
          } catch {
            ok = false;
          }
        }

        if (!ok) {
          // A stale-time throw escaped mid-write. The chart may now hold a
          // partial update, but the full path below (setData) overwrites the
          // whole series, so falling through recovers within this same render
          // instead of leaving broken state up to the next 10s poll. Invalidate
          // bookkeeping so a corrupted state is never recorded as "applied".
          prevBarCountRef.current = 0;
          prevEarliestTimeRef.current = null;
          prevLastTimeRef.current = null;
        } else {
          // 与全量路径同样维护尾蜡烛 ref 与 meta
          lastCandleRef.current = {
            time: times[lastIdx],
            open: input.open[lastIdx],
            high: input.high[lastIdx],
            low: input.low[lastIdx],
            close: input.close[lastIdx],
            volume: input.volume[lastIdx],
          };
          prevEarliestTimeRef.current = times[0] ?? null;
          prevBarCountRef.current = times.length;
          prevLastTimeRef.current = times[lastIdx] ?? null;
          return;
        }
      }
      // tailKind === "regressed", or the write above failed: fall through to
      // the full path below instead of trusting/returning from a bad increment.
    }

    // Detect whether this update is "an older page got prepended" (as opposed
    // to a fresh symbol load or a latest-page poll refresh): the new array's
    // first candle is earlier than the previously recorded earliest one. If so,
    // save the current visible range and shift it back after setData, since
    // otherwise the user's view would appear to "jump" because the logical
    // coordinate origin moved.
    const isPrepend =
      !isFirstDataRef.current &&
      prevEarliestTimeRef.current !== null &&
      times.length > 0 &&
      times[0] < prevEarliestTimeRef.current;
    const savedRange = isPrepend ? chartApi.timeScale().getVisibleLogicalRange() : null;

    const candleData: CandlestickData[] = times.map((time, i) => ({
      time,
      open: input.open[i],
      high: input.high[i],
      low: input.low[i],
      close: input.close[i],
    }));
    candleSeries.setData(candleData);

    if (savedRange) {
      const addedBars = times.length - prevBarCountRef.current;
      try {
        chartApi.timeScale().setVisibleLogicalRange({
          from: savedRange.from + addedBars,
          to: savedRange.to + addedBars,
        });
      } catch { /* chart not ready to accept a manual range yet */ }
    }
    prevEarliestTimeRef.current = times[0] ?? null;
    prevBarCountRef.current = times.length;
    prevLastTimeRef.current = times.length ? times[times.length - 1] : null;

    for (const a of applied) {
      const def = INDICATOR_BY_ID.get(a.defId);
      const entries = seriesMapRef.current.get(a.instanceId);
      if (!def || !entries) continue;

      let out: Record<string, (number | null)[]>;
      try {
        out = def.compute(input, a.params);
      } catch {
        continue; // a bad param combination must not take the whole chart down
      }

      const visible = a.visible && isAllowed(def.id);
      for (const e of entries) {
        const plot = def.plots.find((p) => p.key === e.plotKey);
        const values = out[e.plotKey];
        if (!plot || !values) {
          e.series.applyOptions({ visible: false });
          continue;
        }

        const resolvedStyle = resolvePlotStyle(def, a.styleOverrides, e.plotKey);

        if (plot.kind === "histogram") {
          const data: HistogramData[] = [];
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v === null || v === undefined || Number.isNaN(v)) continue;
            data.push({
              time: times[i],
              value: v,
              color: plot.barColor ? plot.barColor({ i, value: v, input }) : resolvedStyle.color,
            });
          }
          e.series.setData(data);
        } else {
          const data: LineData[] = [];
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v === null || v === undefined || Number.isNaN(v)) continue;
            data.push({ time: times[i], value: v });
          }
          e.series.setData(data);
        }
        e.series.applyOptions({
          visible,
          color: resolvedStyle.color,
          ...(plot.kind !== "histogram" && plot.kind !== "dots"
            ? { lineWidth: resolvedStyle.lineWidth, lineStyle: resolvedStyle.lineStyle }
            : {}),
        });
      }
    }

    // Track the last candle so live prices can extend it
    const lastIdx = times.length - 1;
    lastCandleRef.current = {
      time: times[lastIdx],
      open: input.open[lastIdx],
      high: input.high[lastIdx],
      low: input.low[lastIdx],
      close: input.close[lastIdx],
      volume: input.volume[lastIdx],
    };

    if (isFirstDataRef.current) {
      chartApi.timeScale().fitContent();
      isFirstDataRef.current = false;
    }
    lastAppliedRef.current = applied;
    lastAdvancedRef.current = hasAdvancedChart;
    // `applied` covers both param edits and visibility toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, candleSeries, bars, applied, structureKey, hasAdvancedChart, isPlaceholder]);

  // ---- Drive the current candle with live ticker price (rAF-throttled) ----
  useEffect(() => {
    pendingPriceRef.current = livePrice;
  }, [livePrice]);

  useEffect(() => {
    if (!candleSeries) return;
    let disposed = false;

    function tick() {
      if (disposed) return;
      rafRef.current = requestAnimationFrame(tick);

      if (isPlaceholderRef.current) return; // 切 symbol 的过渡帧不往旧 series 上画新 symbol 的价

      const price = pendingPriceRef.current;
      if (price === undefined || isNaN(price)) return;
      if (!candleSeries) return;

      const durationSec = INTERVAL_SECONDS[interval] ?? 3600;
      const nowSec = Math.floor(Date.now() / 1000);
      const bucketStart = (Math.floor(nowSec / durationSec) * durationSec) as UTCTimestamp;

      const prev = lastCandleRef.current;

      if (!prev || bucketStart > prev.time) {
        const fresh = {
          time: bucketStart,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
        };
        lastCandleRef.current = fresh;
        try {
          candleSeries.update({
            time: fresh.time,
            open: fresh.open,
            high: fresh.high,
            low: fresh.low,
            close: fresh.close,
          });
        } catch { /* chart may not be ready */ }
        return;
      }

      if (bucketStart < prev.time) return;

      prev.close = price;
      if (price > prev.high) prev.high = price;
      if (price < prev.low) prev.low = price;

      try {
        candleSeries.update({
          time: prev.time,
          open: prev.open,
          high: prev.high,
          low: prev.low,
          close: prev.close,
        });
      } catch { /* ignore transient update errors */ }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [interval, candleSeries]);

  // ---- Entry/exit trade markers (arrows on the candles) ----
  useEffect(() => {
    if (!markersPluginRef.current) return;

    const durationSec = INTERVAL_SECONDS[interval] ?? 3600;
    const markers = (tradeMarkers ?? [])
      .map((m): SeriesMarker<Time> => {
        const isBuy = m.side === "buy";
        // 对齐到成交时间所在的 K 线起点，避免落在两根蜡烛之间
        const sec = Math.floor(m.time / 1000);
        const bucket = (Math.floor(sec / durationSec) * durationSec) as UTCTimestamp;
        return {
          time: bucket as Time,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? UP : DOWN,
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: m.text,
        };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));

    const sig = overlaySignature(markers as unknown as Record<string, unknown>[]);
    if (sig === markersSigRef.current) return;
    markersSigRef.current = sig;
    markersPluginRef.current.setMarkers(markers);
  }, [tradeMarkers, interval, candleSeries]);

  // ---- Price lines (entry / take-profit / stop-loss / liquidation) ----
  useEffect(() => {
    if (!candleSeries) return;

    // Editable (止盈/止损) lines render on their own draggable SVG layer instead.
    const renderable = (priceLines ?? []).filter(
      (pl) => !pl.editable && isFinite(pl.price) && pl.price > 0
    );
    const sig = overlaySignature(
      renderable.map((pl) => ({ p: pl.price, c: pl.color, d: pl.dashed, t: pl.title }))
    );
    if (sig === priceLinesSigRef.current) return;
    priceLinesSigRef.current = sig;

    // 清掉旧的价格线
    for (const line of priceLinesRef.current) {
      try { candleSeries.removePriceLine(line); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    for (const pl of renderable) {
      try {
        const line = candleSeries.createPriceLine({
          price: pl.price,
          color: pl.color,
          lineWidth: 1,
          lineStyle: pl.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: pl.title,
        });
        priceLinesRef.current.push(line);
      } catch { /* ignore */ }
    }
  }, [priceLines, candleSeries]);

  // ---- Load an older page when the user scrolls near the left edge of loaded data ----
  useEffect(() => {
    if (!chartApi) return;
    const timeScale = chartApi.timeScale();

    function handleRangeChange(range: LogicalRange | null) {
      if (!range) return;
      // Start fetching when we're within ~20 bars of the earliest loaded candle,
      // so data arrives before the user actually scrolls all the way to the end.
      if (range.from < 20 && hasMoreRef.current && !isLoadingMoreRef.current) {
        loadMoreRef.current();
      }
    }

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [chartApi]);

  return (
    <div data-allow-zoom className={cn("relative flex", className)}>
      {hasAdvancedChart && <DrawingToolbar symbol={symbol} />}

      <div className="relative min-w-0 flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          </div>
        )}

        {!isLoading && isPlaceholder && !noData && (
          <div className="pointer-events-none absolute inset-0 z-[6] bg-bg-primary/40" />
        )}

        {/* 休市的外汇/美股在 BingX 侧连历史 K 线都取不到（返回 109415
            "is pause currently"）。这里必须是不透明的：全局 keepPreviousData
            会把上一个品种的蜡烛留在画布上，半透明遮罩挡不住，用户会把别人的
            走势读成当前品种的。 */}
        {noData && (
          <div className="absolute inset-0 z-[8] flex items-center justify-center bg-bg-primary px-4 text-center text-xs text-text-muted">
            {t("no_data")}
          </div>
        )}

        {!isLoading && isLoadingMore && (
          <div className="absolute left-1/2 top-2 z-[7] -translate-x-1/2 rounded-xs border border-border-default bg-bg-secondary/90 px-2 py-0.5 text-[11px] text-text-muted backdrop-blur-sm">
            {t("loading_history")}
          </div>
        )}

        {/* Indicator picker trigger */}
        <div className="absolute left-2 top-2 z-[7]">
          <button
            onClick={() => (hasAdvancedChart ? setIndicatorsOpen(true) : setUpsellOpen((o) => !o))}
            className={cn(
              "flex items-center gap-1 rounded-xs border px-2 py-1 text-xs backdrop-blur-sm transition-colors",
              hasAdvancedChart
                ? "border-border-default bg-bg-secondary/80 text-text-secondary hover:text-text-primary"
                : "border-gold/30 bg-bg-secondary/80 text-gold"
            )}
          >
            {t("title")} {!hasAdvancedChart && !accessLoading && "🔒"}
          </button>

          {upsellOpen && !hasAdvancedChart && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUpsellOpen(false)} />
              <div className="absolute left-0 top-9 z-20 w-56 space-y-2 rounded-md border border-border-default bg-bg-secondary p-3 text-center text-xs shadow-modal">
                <p className="text-text-secondary">
                  {t("pro_upsell")}
                </p>
                <Link
                  href={`/${locale}/upgrade`}
                  className="inline-block font-medium text-gold hover:underline"
                >
                  {t("pro_upsell_cta")} →
                </Link>
              </div>
            </>
          )}
        </div>

        <ChartLegend onOpenSettings={() => setIndicatorsOpen(true)} />

        <div ref={chartRef} className="h-full w-full" />

        {/* Draggable TP/SL lines — independent of the Pro chart-tools gate,
            since this is core order management, not an "advanced chart" perk. */}
        <OrderLineOverlay chart={chartApi} series={candleSeries} lines={priceLines ?? []} containerRef={chartRef} />

        {hasAdvancedChart && (
          <DrawingLayer
            symbol={symbol}
            chart={chartApi}
            series={candleSeries}
            times={drawingTimes}
            containerRef={chartRef}
          />
        )}
      </div>

      <IndicatorModal open={indicatorsOpen} onClose={() => setIndicatorsOpen(false)} />
    </div>
  );
}
