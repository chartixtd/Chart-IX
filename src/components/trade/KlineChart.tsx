"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import { useKlines } from "@/hooks/useMarketData";
import { useMarketStore } from "@/stores/market";
import { cn } from "@/lib/utils";

interface KlineChartProps {
  symbol: string;
  interval?: string;
  className?: string;
}

export function KlineChart({ symbol, interval = "1h", className }: KlineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const isFirstDataRef = useRef(true);
  const lastWsTimeRef = useRef<number>(0);
  const { data: klines, isLoading } = useKlines(symbol, interval);

  // Read WebSocket kline from store for real-time candle updates
  const wsKline = useMarketStore((s) => s.klines[`${symbol}:${interval}`]);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#666666",
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(212, 168, 67, 0.3)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

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
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      isFirstDataRef.current = true;
    };
  }, []);

  // Initial / full data load from REST
  useEffect(() => {
    if (!klines?.length) return;

    const valid = klines
      .filter(
        (k) =>
          k.openTime > 0 &&
          !isNaN(k.open) &&
          !isNaN(k.high) &&
          !isNaN(k.low) &&
          !isNaN(k.close) &&
          !isNaN(k.volume)
      )
      .sort((a, b) => a.openTime - b.openTime);

    if (!valid.length) return;

    const candleData: CandlestickData[] = valid.map((k) => ({
      time: (k.openTime / 1000) as UTCTimestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const volumeData: HistogramData[] = valid.map((k) => ({
      time: (k.openTime / 1000) as UTCTimestamp,
      value: k.volume,
      color: k.close >= k.open ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
    }));

    candleSeriesRef.current?.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);

    if (isFirstDataRef.current) {
      chartApiRef.current?.timeScale().fitContent();
      isFirstDataRef.current = false;
    }
  }, [klines]);

  // Real-time update of the current candle via WebSocket
  useEffect(() => {
    if (!wsKline || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    // Guard: ensure time is a valid number (NaN has typeof "number")
    if (typeof wsKline.openTime !== "number" || isNaN(wsKline.openTime) || wsKline.openTime <= 0) return;

    // Skip duplicate updates (same candle time)
    if (wsKline.openTime === lastWsTimeRef.current) return;

    // lightweight-charts uses seconds
    const time = (wsKline.openTime / 1000) as UTCTimestamp;

    try {
      candleSeriesRef.current.update({
        time,
        open: wsKline.open,
        high: wsKline.high,
        low: wsKline.low,
        close: wsKline.close,
      });

      volumeSeriesRef.current.update({
        time,
        value: wsKline.volume,
        color: wsKline.close >= wsKline.open
          ? "rgba(34, 197, 94, 0.2)"
          : "rgba(239, 68, 68, 0.2)",
      });

      lastWsTimeRef.current = wsKline.openTime;
    } catch (err) {
      console.debug("[KlineChart] update error, will retry on next tick:", err);
    }
  }, [wsKline]);

  return (
    <div className={cn("relative", className)}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
        </div>
      )}
      <div ref={chartRef} className="h-full w-full" />
    </div>
  );
}
