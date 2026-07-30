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
} from "lightweight-charts";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useKlines } from "@/hooks/useMarketData";
import { useMarketStore } from "@/stores/market";
import { useChartStore } from "@/stores/chartStore";
import { useFeatureAccess } from "@/hooks/useFeatureFlags";
import { INDICATOR_BY_ID, type IndicatorInput } from "@/lib/chart/indicator-registry";
import { IndicatorModal } from "./chart/IndicatorModal";
import { ChartLegend } from "./chart/ChartLegend";
import { DrawingToolbar } from "./chart/DrawingToolbar";
import { DrawingLayer } from "./chart/DrawingLayer";
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
}

interface KlineChartProps {
  symbol: string;
  interval?: string;
  className?: string;
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

export function KlineChart({ symbol, interval = "1h", className, tradeMarkers, priceLines }: KlineChartProps) {
  const locale = useLocale();
  const chartRef = useRef<HTMLDivElement>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const seriesMapRef = useRef<Map<string, InstanceSeries[]>>(new Map());
  const isFirstDataRef = useRef(true);

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

  const { data: klines, isLoading } = useKlines(symbol, interval);
  // Live price from WebSocket ticker (drives the current candle in real time)
  const livePrice = useMarketStore((s) => {
    const t = s.tickers[symbol];
    return t ? Number(t.lastPrice) : undefined;
  });

  const { hasAccess: hasAdvancedChart, loading: accessLoading } = useFeatureAccess("advanced_chart");

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
      setChartApi(null);
      setCandleSeries(null);
      isFirstDataRef.current = true;
      lastCandleRef.current = null;
    };
  }, []);

  // ---- Reset when symbol/interval changes ----
  useEffect(() => {
    isFirstDataRef.current = true;
    lastCandleRef.current = null;
  }, [symbol, interval]);

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
    const { times, input } = bars;

    const candleData: CandlestickData[] = times.map((time, i) => ({
      time,
      open: input.open[i],
      high: input.high[i],
      low: input.low[i],
      close: input.close[i],
    }));
    candleSeries.setData(candleData);

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

        if (plot.kind === "histogram") {
          const data: HistogramData[] = [];
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v === null || v === undefined || Number.isNaN(v)) continue;
            data.push({
              time: times[i],
              value: v,
              color: plot.barColor ? plot.barColor({ i, value: v, input }) : plot.color,
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
        e.series.applyOptions({ visible });
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
    // `applied` covers both param edits and visibility toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, candleSeries, bars, applied, structureKey, hasAdvancedChart]);

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

    markersPluginRef.current.setMarkers(markers);
  }, [tradeMarkers, interval, candleSeries]);

  // ---- Price lines (entry / take-profit / stop-loss / liquidation) ----
  useEffect(() => {
    if (!candleSeries) return;

    // 清掉旧的价格线
    for (const line of priceLinesRef.current) {
      try { candleSeries.removePriceLine(line); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    for (const pl of priceLines ?? []) {
      if (!isFinite(pl.price) || pl.price <= 0) continue;
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

  return (
    <div className={cn("relative flex", className)}>
      {hasAdvancedChart && <DrawingToolbar symbol={symbol} />}

      <div className="relative min-w-0 flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
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
            指标 {!hasAdvancedChart && !accessLoading && "🔒"}
          </button>

          {upsellOpen && !hasAdvancedChart && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUpsellOpen(false)} />
              <div className="absolute left-0 top-9 z-20 w-56 space-y-2 rounded-md border border-border-default bg-bg-secondary p-3 text-center text-xs shadow-modal">
                <p className="text-text-secondary">
                  30+ 技术指标与画图工具为 Pro 专属功能
                </p>
                <Link
                  href={`/${locale}/upgrade`}
                  className="inline-block font-medium text-gold hover:underline"
                >
                  升级 Pro 解锁 →
                </Link>
              </div>
            </>
          )}
        </div>

        <ChartLegend onOpenSettings={() => setIndicatorsOpen(true)} />

        <div ref={chartRef} className="h-full w-full" />

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
