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
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
};

const UP = "#22c55e";
const DOWN = "#ef4444";
const VOL_UP = "rgba(34, 197, 94, 0.2)";
const VOL_DOWN = "rgba(239, 68, 68, 0.2)";

export function KlineChart({ symbol, interval = "1h", className }: KlineChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const isFirstDataRef = useRef(true);

  // Last candle state, kept in sync so ticker updates can mutate it live
  const lastCandleRef = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const { data: klines, isLoading } = useKlines(symbol, interval);
  // Live price from WebSocket ticker (drives the current candle in real time)
  const livePrice = useMarketStore((s) => {
    const t = s.tickers[symbol];
    return t ? parseFloat(t.lastPrice) : undefined;
  });

  // ---- Create chart once ----
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
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: VOL_UP,
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
      lastCandleRef.current = null;
    };
  }, []);

  // ---- Reset when symbol/interval changes ----
  useEffect(() => {
    isFirstDataRef.current = true;
    lastCandleRef.current = null;
  }, [symbol, interval]);

  // ---- Load full history from REST ----
  useEffect(() => {
    if (!klines?.length || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const valid = klines
      .filter(
        (k) =>
          k.openTime > 0 &&
          !isNaN(k.open) && !isNaN(k.high) && !isNaN(k.low) &&
          !isNaN(k.close) && !isNaN(k.volume)
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
      color: k.close >= k.open ? VOL_UP : VOL_DOWN,
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Track the last candle so live prices can extend it
    const last = valid[valid.length - 1];
    lastCandleRef.current = {
      time: (last.openTime / 1000) as UTCTimestamp,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
    };

    if (isFirstDataRef.current) {
      chartApiRef.current?.timeScale().fitContent();
      isFirstDataRef.current = false;
    }
  }, [klines]);

  // ---- Drive the current candle with live ticker price ----
  useEffect(() => {
    if (livePrice === undefined || isNaN(livePrice)) return;
    if (!candleSeriesRef.current) return;

    const durationSec = INTERVAL_SECONDS[interval] ?? 3600;
    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = (Math.floor(nowSec / durationSec) * durationSec) as UTCTimestamp;

    const prev = lastCandleRef.current;

    // New candle bucket started → open a fresh candle at the live price
    if (!prev || bucketStart > prev.time) {
      const fresh = {
        time: bucketStart,
        open: livePrice,
        high: livePrice,
        low: livePrice,
        close: livePrice,
        volume: 0,
      };
      lastCandleRef.current = fresh;
      try {
        candleSeriesRef.current.update({
          time: fresh.time,
          open: fresh.open,
          high: fresh.high,
          low: fresh.low,
          close: fresh.close,
        });
      } catch {
        /* chart may not be ready yet */
      }
      return;
    }

    // Only extend the current bucket (never mutate a past candle)
    if (bucketStart < prev.time) return;

    prev.close = livePrice;
    if (livePrice > prev.high) prev.high = livePrice;
    if (livePrice < prev.low) prev.low = livePrice;

    try {
      candleSeriesRef.current.update({
        time: prev.time,
        open: prev.open,
        high: prev.high,
        low: prev.low,
        close: prev.close,
      });
    } catch {
      /* ignore transient update errors */
    }
  }, [livePrice, interval]);

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
