"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  useTradePrefsStore, type ChartBottomPane, type ChartIndicatorParams, type ChartIndicatorSettings,
} from "@/stores/tradePrefs";
import { useFeatureAccess } from "@/hooks/useFeatureFlags";
import {
  computeMA, computeEMA, computeRSI, computeMACD, computeBollingerBands, computeVWAP,
  computeATR, computeStochastic, computeCCI, computeWilliamsR, computeOBV, computeADX,
  computeParabolicSAR, computeVWMA, computeKeltnerChannels, computeDonchianChannels,
  computeSuperTrend, computeMomentum, computeROC, computeMFI, computeTRIX,
  computeDEMA, computeTEMA, computeEnvelope, computeIchimoku, computeCMF, computeAroon,
  computeUltimateOscillator, computeCMO, computeDPO, computeStdDev,
} from "@/lib/indicators";
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
const VOL_UP = "rgba(34, 197, 94, 0.2)";
const VOL_DOWN = "rgba(239, 68, 68, 0.2)";
const MA7_COLOR = "#60a5fa";
const MA25_COLOR = "#f59e0b";
const RSI_COLOR = "#c084fc";
const EMA12_COLOR = "#c084fc";
const EMA26_COLOR = "#22d3ee";
const BB_COLOR = "rgba(200,160,80,0.4)";
const VWAP_COLOR = "#fbbf24";
const MACD_COLOR = "#60a5fa";
const SIGNAL_COLOR = "#f59e0b";
const HIST_GREEN = "#22c55e";
const HIST_RED = "#ef4444";
const SAR_COLOR = "#e879f9";
const STOCH_K_COLOR = "#60a5fa";
const STOCH_D_COLOR = "#f59e0b";
const CCI_COLOR = "#22d3ee";
const WILLR_COLOR = "#f472b6";
const ATR_COLOR = "#a3e635";
const ADX_COLOR = "#fb923c";
const OBV_COLOR = "#38bdf8";
const VWMA_COLOR = "#2dd4bf";
const KC_COLOR = "rgba(96,165,250,0.4)";
const DONCHIAN_COLOR = "rgba(163,230,53,0.4)";
const SUPERTREND_COLOR = "#22c55e";
const MOMENTUM_COLOR = "#818cf8";
const ROC_COLOR = "#f472b6";
const MFI_COLOR = "#fbbf24";
const TRIX_COLOR = "#60a5fa";
const DEMA_COLOR = "#fb7185";
const TEMA_COLOR = "#34d399";
const ENVELOPE_COLOR = "rgba(163,113,247,0.4)";
const ICHIMOKU_TENKAN_COLOR = "#f87171";
const ICHIMOKU_KIJUN_COLOR = "#60a5fa";
const ICHIMOKU_SPAN_A_COLOR = "rgba(34,197,94,0.4)";
const ICHIMOKU_SPAN_B_COLOR = "rgba(239,68,68,0.4)";
const CMF_COLOR = "#2dd4bf";
const AROON_UP_COLOR = "#22c55e";
const AROON_DOWN_COLOR = "#ef4444";
const UO_COLOR = "#c084fc";
const CMO_COLOR = "#fb923c";
const DPO_COLOR = "#38bdf8";
const STDDEV_COLOR = "#a3e635";

interface ParamField {
  key: keyof ChartIndicatorParams;
  step?: number;
}

type BooleanIndicatorKey = Exclude<keyof ChartIndicatorSettings, "bottomPane">;

interface OverlayDescriptor {
  toggleKey: BooleanIndicatorKey;
  label: string;
  params?: ParamField[];
}

interface BottomPaneDescriptor {
  key: ChartBottomPane;
  label: string;
  params?: ParamField[];
}

const OVERLAY_INDICATORS: OverlayDescriptor[] = [
  { toggleKey: "showMA", label: "MA 均线", params: [{ key: "maPeriod1" }, { key: "maPeriod2" }] },
  { toggleKey: "showEMA", label: "EMA", params: [{ key: "emaPeriod1" }, { key: "emaPeriod2" }] },
  { toggleKey: "showBB", label: "Bollinger Bands", params: [{ key: "bbPeriod" }, { key: "bbMultiplier", step: 0.1 }] },
  { toggleKey: "showVWAP", label: "VWAP" },
  { toggleKey: "showVWMA", label: "VWMA", params: [{ key: "vwmaPeriod" }] },
  { toggleKey: "showSAR", label: "抛物线 SAR", params: [{ key: "sarStep", step: 0.01 }, { key: "sarMax", step: 0.01 }] },
  { toggleKey: "showKC", label: "Keltner Channels", params: [{ key: "kcPeriod" }, { key: "kcAtrPeriod" }, { key: "kcMultiplier", step: 0.1 }] },
  { toggleKey: "showDonchian", label: "Donchian Channels", params: [{ key: "donchianPeriod" }] },
  { toggleKey: "showSuperTrend", label: "SuperTrend", params: [{ key: "superTrendPeriod" }, { key: "superTrendMultiplier", step: 0.5 }] },
  { toggleKey: "showDEMA", label: "DEMA", params: [{ key: "demaPeriod" }] },
  { toggleKey: "showTEMA", label: "TEMA", params: [{ key: "temaPeriod" }] },
  { toggleKey: "showEnvelope", label: "Envelope 通道", params: [{ key: "envelopePeriod" }, { key: "envelopePercent", step: 0.1 }] },
  { toggleKey: "showIchimoku", label: "一目均衡表", params: [{ key: "ichimokuTenkan" }, { key: "ichimokuKijun" }, { key: "ichimokuSenkouB" }] },
];

const BOTTOM_PANE_INDICATORS: BottomPaneDescriptor[] = [
  { key: "volume", label: "成交量" },
  { key: "rsi", label: "RSI", params: [{ key: "rsiPeriod" }] },
  { key: "macd", label: "MACD", params: [{ key: "macdFast" }, { key: "macdSlow" }, { key: "macdSignal" }] },
  { key: "stoch", label: "随机指标", params: [{ key: "stochKPeriod" }, { key: "stochDPeriod" }] },
  { key: "cci", label: "CCI", params: [{ key: "cciPeriod" }] },
  { key: "willr", label: "威廉%R", params: [{ key: "willrPeriod" }] },
  { key: "atr", label: "ATR", params: [{ key: "atrPeriod" }] },
  { key: "adx", label: "ADX", params: [{ key: "adxPeriod" }] },
  { key: "obv", label: "OBV" },
  { key: "momentum", label: "动量指标", params: [{ key: "momentumPeriod" }] },
  { key: "roc", label: "ROC", params: [{ key: "rocPeriod" }] },
  { key: "mfi", label: "资金流量指标", params: [{ key: "mfiPeriod" }] },
  { key: "trix", label: "TRIX", params: [{ key: "trixPeriod" }] },
  { key: "cmf", label: "佳庆资金流量", params: [{ key: "cmfPeriod" }] },
  { key: "aroon", label: "Aroon", params: [{ key: "aroonPeriod" }] },
  { key: "uo", label: "终极震荡指标", params: [{ key: "uoPeriod1" }, { key: "uoPeriod2" }, { key: "uoPeriod3" }] },
  { key: "cmo", label: "钱德动量摆动", params: [{ key: "cmoPeriod" }] },
  { key: "dpo", label: "区间震荡指标", params: [{ key: "dpoPeriod" }] },
  { key: "stddev", label: "标准差", params: [{ key: "stddevPeriod" }] },
];

/** Small inline numeric field used by the indicator panel's editable periods. */
function NumberField({
  value,
  step = 1,
  onChange,
}: {
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
      className="w-11 rounded-xs border border-border-default bg-bg-tertiary px-1 py-0.5 text-center text-[11px] text-text-primary focus:border-gold focus:outline-none"
    />
  );
}

export function KlineChart({ symbol, interval = "1h", className, tradeMarkers, priceLines }: KlineChartProps) {
  const locale = useLocale();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema12SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema26SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const histogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sarSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stochKSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stochDSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const cciSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const willrSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const atrSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const adxSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const obvSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const kcUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const kcLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const donchianUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const donchianLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const superTrendSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const momentumSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rocSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const mfiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const trixSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const demaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const temaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const envelopeUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const envelopeLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ichimokuTenkanSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ichimokuKijunSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ichimokuSpanASeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ichimokuSpanBSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const cmfSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const aroonUpSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const aroonDownSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const uoSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const cmoSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dpoSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stddevSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);

  // Indicator visibility persists per-user (zustand localStorage + PreferencesSync to Supabase)
  const chartIndicators = useTradePrefsStore((s) => s.chartIndicators);
  const setChartIndicators = useTradePrefsStore((s) => s.setChartIndicators);
  const {
    showMA, showEMA, showBB, showVWAP, showSAR, showVWMA, showKC, showDonchian, showSuperTrend,
    showDEMA, showTEMA, showEnvelope, showIchimoku, bottomPane,
  } = chartIndicators;
  const setBottomPane = (key: ChartBottomPane) => setChartIndicators({ bottomPane: key });

  // Indicator periods/multipliers — also persisted, editable from the same panel
  const indicatorParams = useTradePrefsStore((s) => s.indicatorParams);
  const setIndicatorParams = useTradePrefsStore((s) => s.setIndicatorParams);
  const resetIndicatorParams = useTradePrefsStore((s) => s.resetIndicatorParams);

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

    const ma7Series = chart.addSeries(LineSeries, {
      color: MA7_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ma25Series = chart.addSeries(LineSeries, {
      color: MA25_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const rsiSeries = chart.addSeries(LineSeries, {
      color: RSI_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "rsi", visible: false,
    });
    chart.priceScale("rsi").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      autoScale: true,
    });

    const ema12Series = chart.addSeries(LineSeries, {
      color: EMA12_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ema26Series = chart.addSeries(LineSeries, {
      color: EMA26_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: BB_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: BB_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const vwapSeries = chart.addSeries(LineSeries, {
      color: VWAP_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });

    const macdSeries = chart.addSeries(LineSeries, {
      color: MACD_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "macd", visible: false,
    });
    const signalSeries = chart.addSeries(LineSeries, {
      color: SIGNAL_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "macd", visible: false,
    });
    const histogramSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "macd", visible: false,
    });
    chart.priceScale("macd").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      autoScale: true,
    });

    const sarSeries = chart.addSeries(LineSeries, {
      color: SAR_COLOR, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2,
      priceLineVisible: false, lastValueVisible: false, visible: false,
    });

    const stochKSeries = chart.addSeries(LineSeries, {
      color: STOCH_K_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "stoch", visible: false,
    });
    const stochDSeries = chart.addSeries(LineSeries, {
      color: STOCH_D_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "stoch", visible: false,
    });
    chart.priceScale("stoch").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const cciSeries = chart.addSeries(LineSeries, {
      color: CCI_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "cci", visible: false,
    });
    chart.priceScale("cci").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const willrSeries = chart.addSeries(LineSeries, {
      color: WILLR_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "willr", visible: false,
    });
    chart.priceScale("willr").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const atrSeries = chart.addSeries(LineSeries, {
      color: ATR_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "atr", visible: false,
    });
    chart.priceScale("atr").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const adxSeries = chart.addSeries(LineSeries, {
      color: ADX_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "adx", visible: false,
    });
    chart.priceScale("adx").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const obvSeries = chart.addSeries(LineSeries, {
      color: OBV_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "obv", visible: false,
    });
    chart.priceScale("obv").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const vwmaSeries = chart.addSeries(LineSeries, {
      color: VWMA_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const kcUpperSeries = chart.addSeries(LineSeries, {
      color: KC_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const kcLowerSeries = chart.addSeries(LineSeries, {
      color: KC_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const donchianUpperSeries = chart.addSeries(LineSeries, {
      color: DONCHIAN_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const donchianLowerSeries = chart.addSeries(LineSeries, {
      color: DONCHIAN_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const superTrendSeries = chart.addSeries(LineSeries, {
      color: SUPERTREND_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });

    const momentumSeries = chart.addSeries(LineSeries, {
      color: MOMENTUM_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "momentum", visible: false,
    });
    chart.priceScale("momentum").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const rocSeries = chart.addSeries(LineSeries, {
      color: ROC_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "roc", visible: false,
    });
    chart.priceScale("roc").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const mfiSeries = chart.addSeries(LineSeries, {
      color: MFI_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "mfi", visible: false,
    });
    chart.priceScale("mfi").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const trixSeries = chart.addSeries(LineSeries, {
      color: TRIX_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "trix", visible: false,
    });
    chart.priceScale("trix").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const demaSeries = chart.addSeries(LineSeries, {
      color: DEMA_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const temaSeries = chart.addSeries(LineSeries, {
      color: TEMA_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const envelopeUpperSeries = chart.addSeries(LineSeries, {
      color: ENVELOPE_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const envelopeLowerSeries = chart.addSeries(LineSeries, {
      color: ENVELOPE_COLOR, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ichimokuTenkanSeries = chart.addSeries(LineSeries, {
      color: ICHIMOKU_TENKAN_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ichimokuKijunSeries = chart.addSeries(LineSeries, {
      color: ICHIMOKU_KIJUN_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ichimokuSpanASeries = chart.addSeries(LineSeries, {
      color: ICHIMOKU_SPAN_A_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });
    const ichimokuSpanBSeries = chart.addSeries(LineSeries, {
      color: ICHIMOKU_SPAN_B_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, visible: false,
    });

    const cmfSeries = chart.addSeries(LineSeries, {
      color: CMF_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "cmf", visible: false,
    });
    chart.priceScale("cmf").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const aroonUpSeries = chart.addSeries(LineSeries, {
      color: AROON_UP_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "aroon", visible: false,
    });
    const aroonDownSeries = chart.addSeries(LineSeries, {
      color: AROON_DOWN_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "aroon", visible: false,
    });
    chart.priceScale("aroon").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const uoSeries = chart.addSeries(LineSeries, {
      color: UO_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "uo", visible: false,
    });
    chart.priceScale("uo").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const cmoSeries = chart.addSeries(LineSeries, {
      color: CMO_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "cmo", visible: false,
    });
    chart.priceScale("cmo").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const dpoSeries = chart.addSeries(LineSeries, {
      color: DPO_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "dpo", visible: false,
    });
    chart.priceScale("dpo").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    const stddevSeries = chart.addSeries(LineSeries, {
      color: STDDEV_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      priceScaleId: "stddev", visible: false,
    });
    chart.priceScale("stddev").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, autoScale: true });

    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);
    volumeSeriesRef.current = volumeSeries;
    ma7SeriesRef.current = ma7Series;
    ma25SeriesRef.current = ma25Series;
    rsiSeriesRef.current = rsiSeries;
    ema12SeriesRef.current = ema12Series;
    ema26SeriesRef.current = ema26Series;
    bbUpperSeriesRef.current = bbUpperSeries;
    bbLowerSeriesRef.current = bbLowerSeries;
    vwapSeriesRef.current = vwapSeries;
    macdSeriesRef.current = macdSeries;
    signalSeriesRef.current = signalSeries;
    histogramSeriesRef.current = histogramSeries;
    sarSeriesRef.current = sarSeries;
    stochKSeriesRef.current = stochKSeries;
    stochDSeriesRef.current = stochDSeries;
    cciSeriesRef.current = cciSeries;
    willrSeriesRef.current = willrSeries;
    atrSeriesRef.current = atrSeries;
    adxSeriesRef.current = adxSeries;
    obvSeriesRef.current = obvSeries;
    vwmaSeriesRef.current = vwmaSeries;
    kcUpperSeriesRef.current = kcUpperSeries;
    kcLowerSeriesRef.current = kcLowerSeries;
    donchianUpperSeriesRef.current = donchianUpperSeries;
    donchianLowerSeriesRef.current = donchianLowerSeries;
    superTrendSeriesRef.current = superTrendSeries;
    momentumSeriesRef.current = momentumSeries;
    rocSeriesRef.current = rocSeries;
    mfiSeriesRef.current = mfiSeries;
    trixSeriesRef.current = trixSeries;
    demaSeriesRef.current = demaSeries;
    temaSeriesRef.current = temaSeries;
    envelopeUpperSeriesRef.current = envelopeUpperSeries;
    envelopeLowerSeriesRef.current = envelopeLowerSeries;
    ichimokuTenkanSeriesRef.current = ichimokuTenkanSeries;
    ichimokuKijunSeriesRef.current = ichimokuKijunSeries;
    ichimokuSpanASeriesRef.current = ichimokuSpanASeries;
    ichimokuSpanBSeriesRef.current = ichimokuSpanBSeries;
    cmfSeriesRef.current = cmfSeries;
    aroonUpSeriesRef.current = aroonUpSeries;
    aroonDownSeriesRef.current = aroonDownSeries;
    uoSeriesRef.current = uoSeries;
    cmoSeriesRef.current = cmoSeries;
    dpoSeriesRef.current = dpoSeries;
    stddevSeriesRef.current = stddevSeries;

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
      markersPluginRef.current = null;
      priceLinesRef.current = [];
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      rsiSeriesRef.current = null;
      ema12SeriesRef.current = null;
      ema26SeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      vwapSeriesRef.current = null;
      macdSeriesRef.current = null;
      signalSeriesRef.current = null;
      histogramSeriesRef.current = null;
      sarSeriesRef.current = null;
      stochKSeriesRef.current = null;
      stochDSeriesRef.current = null;
      cciSeriesRef.current = null;
      willrSeriesRef.current = null;
      atrSeriesRef.current = null;
      adxSeriesRef.current = null;
      obvSeriesRef.current = null;
      vwmaSeriesRef.current = null;
      kcUpperSeriesRef.current = null;
      kcLowerSeriesRef.current = null;
      donchianUpperSeriesRef.current = null;
      donchianLowerSeriesRef.current = null;
      superTrendSeriesRef.current = null;
      momentumSeriesRef.current = null;
      rocSeriesRef.current = null;
      mfiSeriesRef.current = null;
      trixSeriesRef.current = null;
      demaSeriesRef.current = null;
      temaSeriesRef.current = null;
      envelopeUpperSeriesRef.current = null;
      envelopeLowerSeriesRef.current = null;
      ichimokuTenkanSeriesRef.current = null;
      ichimokuKijunSeriesRef.current = null;
      ichimokuSpanASeriesRef.current = null;
      ichimokuSpanBSeriesRef.current = null;
      cmfSeriesRef.current = null;
      aroonUpSeriesRef.current = null;
      aroonDownSeriesRef.current = null;
      uoSeriesRef.current = null;
      cmoSeriesRef.current = null;
      dpoSeriesRef.current = null;
      stddevSeriesRef.current = null;
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

    // Indicators (Pro only, but harmless to compute — visibility is gated separately)
    const closes = valid.map((k) => k.close);
    const times = valid.map((k) => (k.openTime / 1000) as UTCTimestamp);

    type Point = { time: UTCTimestamp; value: number };
    const toLineData = (values: (number | null)[]): Point[] => {
      const points: Point[] = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v !== null) points.push({ time: times[i], value: v });
      }
      return points;
    };

    const p = indicatorParams;

    const ma7Data = toLineData(computeMA(closes, p.maPeriod1));
    const ma25Data = toLineData(computeMA(closes, p.maPeriod2));
    ma7SeriesRef.current?.setData(ma7Data as LineData[]);
    ma25SeriesRef.current?.setData(ma25Data as LineData[]);

    const rsiData = toLineData(computeRSI(closes, p.rsiPeriod));
    rsiSeriesRef.current?.setData(rsiData as LineData[]);

    // EMA
    const ema12Data = toLineData(computeEMA(closes, p.emaPeriod1));
    const ema26Data = toLineData(computeEMA(closes, p.emaPeriod2));
    ema12SeriesRef.current?.setData(ema12Data as LineData[]);
    ema26SeriesRef.current?.setData(ema26Data as LineData[]);

    // Bollinger Bands
    const bb = computeBollingerBands(closes, p.bbPeriod, p.bbMultiplier);
    const bbUpperData = toLineData(bb.upper);
    const bbLowerData = toLineData(bb.lower);
    bbUpperSeriesRef.current?.setData(bbUpperData as LineData[]);
    bbLowerSeriesRef.current?.setData(bbLowerData as LineData[]);

    // VWAP
    const highs = valid.map((k) => k.high);
    const lows = valid.map((k) => k.low);
    const volumes = valid.map((k) => k.volume);
    const vwapData = toLineData(computeVWAP(highs, lows, closes, volumes));
    vwapSeriesRef.current?.setData(vwapData as LineData[]);

    // MACD
    const macdResult = computeMACD(closes, p.macdFast, p.macdSlow, p.macdSignal);
    const macdLineData = toLineData(macdResult.macd);
    const signalLineData = toLineData(macdResult.signal);
    macdSeriesRef.current?.setData(macdLineData as LineData[]);
    signalSeriesRef.current?.setData(signalLineData as LineData[]);

    // Histogram with colored bars
    const histData: HistogramData[] = [];
    for (let i = 0; i < macdResult.histogram.length; i++) {
      const v = macdResult.histogram[i];
      if (v !== null) {
        histData.push({
          time: times[i],
          value: Math.abs(v),
          color: v >= 0 ? HIST_GREEN : HIST_RED,
        });
      }
    }
    histogramSeriesRef.current?.setData(histData);

    // Parabolic SAR
    const sarData = toLineData(computeParabolicSAR(highs, lows, p.sarStep, p.sarMax));
    sarSeriesRef.current?.setData(sarData as LineData[]);

    // Stochastic Oscillator
    const stoch = computeStochastic(highs, lows, closes, p.stochKPeriod, p.stochDPeriod);
    stochKSeriesRef.current?.setData(toLineData(stoch.k) as LineData[]);
    stochDSeriesRef.current?.setData(toLineData(stoch.d) as LineData[]);

    // CCI
    const cciData = toLineData(computeCCI(highs, lows, closes, p.cciPeriod));
    cciSeriesRef.current?.setData(cciData as LineData[]);

    // Williams %R
    const willrData = toLineData(computeWilliamsR(highs, lows, closes, p.willrPeriod));
    willrSeriesRef.current?.setData(willrData as LineData[]);

    // ATR
    const atrData = toLineData(computeATR(highs, lows, closes, p.atrPeriod));
    atrSeriesRef.current?.setData(atrData as LineData[]);

    // ADX
    const adxData = toLineData(computeADX(highs, lows, closes, p.adxPeriod));
    adxSeriesRef.current?.setData(adxData as LineData[]);

    // OBV
    const obvData = toLineData(computeOBV(closes, volumes));
    obvSeriesRef.current?.setData(obvData as LineData[]);

    // VWMA
    const vwmaData = toLineData(computeVWMA(closes, volumes, p.vwmaPeriod));
    vwmaSeriesRef.current?.setData(vwmaData as LineData[]);

    // Keltner Channels
    const kc = computeKeltnerChannels(highs, lows, closes, p.kcPeriod, p.kcAtrPeriod, p.kcMultiplier);
    kcUpperSeriesRef.current?.setData(toLineData(kc.upper) as LineData[]);
    kcLowerSeriesRef.current?.setData(toLineData(kc.lower) as LineData[]);

    // Donchian Channels
    const donchian = computeDonchianChannels(highs, lows, p.donchianPeriod);
    donchianUpperSeriesRef.current?.setData(toLineData(donchian.upper) as LineData[]);
    donchianLowerSeriesRef.current?.setData(toLineData(donchian.lower) as LineData[]);

    // SuperTrend
    const superTrend = computeSuperTrend(highs, lows, closes, p.superTrendPeriod, p.superTrendMultiplier);
    superTrendSeriesRef.current?.setData(toLineData(superTrend.value) as LineData[]);

    // Momentum
    const momentumData = toLineData(computeMomentum(closes, p.momentumPeriod));
    momentumSeriesRef.current?.setData(momentumData as LineData[]);

    // ROC
    const rocData = toLineData(computeROC(closes, p.rocPeriod));
    rocSeriesRef.current?.setData(rocData as LineData[]);

    // MFI
    const mfiData = toLineData(computeMFI(highs, lows, closes, volumes, p.mfiPeriod));
    mfiSeriesRef.current?.setData(mfiData as LineData[]);

    // TRIX
    const trixData = toLineData(computeTRIX(closes, p.trixPeriod));
    trixSeriesRef.current?.setData(trixData as LineData[]);

    // DEMA / TEMA
    demaSeriesRef.current?.setData(toLineData(computeDEMA(closes, p.demaPeriod)) as LineData[]);
    temaSeriesRef.current?.setData(toLineData(computeTEMA(closes, p.temaPeriod)) as LineData[]);

    // Envelope
    const envelope = computeEnvelope(closes, p.envelopePeriod, p.envelopePercent);
    envelopeUpperSeriesRef.current?.setData(toLineData(envelope.upper) as LineData[]);
    envelopeLowerSeriesRef.current?.setData(toLineData(envelope.lower) as LineData[]);

    // Ichimoku
    const ichimoku = computeIchimoku(highs, lows, p.ichimokuTenkan, p.ichimokuKijun, p.ichimokuSenkouB);
    ichimokuTenkanSeriesRef.current?.setData(toLineData(ichimoku.tenkan) as LineData[]);
    ichimokuKijunSeriesRef.current?.setData(toLineData(ichimoku.kijun) as LineData[]);
    ichimokuSpanASeriesRef.current?.setData(toLineData(ichimoku.senkouA) as LineData[]);
    ichimokuSpanBSeriesRef.current?.setData(toLineData(ichimoku.senkouB) as LineData[]);

    // CMF
    const cmfData = toLineData(computeCMF(highs, lows, closes, volumes, p.cmfPeriod));
    cmfSeriesRef.current?.setData(cmfData as LineData[]);

    // Aroon
    const aroon = computeAroon(highs, lows, p.aroonPeriod);
    aroonUpSeriesRef.current?.setData(toLineData(aroon.up) as LineData[]);
    aroonDownSeriesRef.current?.setData(toLineData(aroon.down) as LineData[]);

    // Ultimate Oscillator
    const uoData = toLineData(computeUltimateOscillator(highs, lows, closes, p.uoPeriod1, p.uoPeriod2, p.uoPeriod3));
    uoSeriesRef.current?.setData(uoData as LineData[]);

    // CMO
    const cmoData = toLineData(computeCMO(closes, p.cmoPeriod));
    cmoSeriesRef.current?.setData(cmoData as LineData[]);

    // DPO
    const dpoData = toLineData(computeDPO(closes, p.dpoPeriod));
    dpoSeriesRef.current?.setData(dpoData as LineData[]);

    // Standard Deviation
    const stddevData = toLineData(computeStdDev(closes, p.stddevPeriod));
    stddevSeriesRef.current?.setData(stddevData as LineData[]);

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
    // Recomputes (cheaply, a few hundred bars) whenever the user edits an
    // indicator period/multiplier, not just when new kline data arrives.
  }, [klines, indicatorParams]);

  // ---- Toggle indicator visibility ----
  useEffect(() => {
    const canShow = hasAdvancedChart;
    ma7SeriesRef.current?.applyOptions({ visible: canShow && showMA });
    ma25SeriesRef.current?.applyOptions({ visible: canShow && showMA });
  }, [showMA, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    ema12SeriesRef.current?.applyOptions({ visible: canShow && showEMA });
    ema26SeriesRef.current?.applyOptions({ visible: canShow && showEMA });
  }, [showEMA, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    bbUpperSeriesRef.current?.applyOptions({ visible: canShow && showBB });
    bbLowerSeriesRef.current?.applyOptions({ visible: canShow && showBB });
  }, [showBB, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    vwapSeriesRef.current?.applyOptions({ visible: canShow && showVWAP });
  }, [showVWAP, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    sarSeriesRef.current?.applyOptions({ visible: canShow && showSAR });
  }, [showSAR, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    vwmaSeriesRef.current?.applyOptions({ visible: canShow && showVWMA });
  }, [showVWMA, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    kcUpperSeriesRef.current?.applyOptions({ visible: canShow && showKC });
    kcLowerSeriesRef.current?.applyOptions({ visible: canShow && showKC });
  }, [showKC, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    donchianUpperSeriesRef.current?.applyOptions({ visible: canShow && showDonchian });
    donchianLowerSeriesRef.current?.applyOptions({ visible: canShow && showDonchian });
  }, [showDonchian, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    superTrendSeriesRef.current?.applyOptions({ visible: canShow && showSuperTrend });
  }, [showSuperTrend, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    demaSeriesRef.current?.applyOptions({ visible: canShow && showDEMA });
  }, [showDEMA, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    temaSeriesRef.current?.applyOptions({ visible: canShow && showTEMA });
  }, [showTEMA, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    envelopeUpperSeriesRef.current?.applyOptions({ visible: canShow && showEnvelope });
    envelopeLowerSeriesRef.current?.applyOptions({ visible: canShow && showEnvelope });
  }, [showEnvelope, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    ichimokuTenkanSeriesRef.current?.applyOptions({ visible: canShow && showIchimoku });
    ichimokuKijunSeriesRef.current?.applyOptions({ visible: canShow && showIchimoku });
    ichimokuSpanASeriesRef.current?.applyOptions({ visible: canShow && showIchimoku });
    ichimokuSpanBSeriesRef.current?.applyOptions({ visible: canShow && showIchimoku });
  }, [showIchimoku, hasAdvancedChart]);

  useEffect(() => {
    const canShow = hasAdvancedChart;
    const want = (p: ChartBottomPane) => canShow && bottomPane === p;
    const wantRsi = want("rsi");
    const wantMacd = want("macd");
    const wantStoch = want("stoch");
    const wantCci = want("cci");
    const wantWillr = want("willr");
    const wantAtr = want("atr");
    const wantAdx = want("adx");
    const wantObv = want("obv");
    const wantMomentum = want("momentum");
    const wantRoc = want("roc");
    const wantMfi = want("mfi");
    const wantTrix = want("trix");
    const wantCmf = want("cmf");
    const wantAroon = want("aroon");
    const wantUo = want("uo");
    const wantCmo = want("cmo");
    const wantDpo = want("dpo");
    const wantStddev = want("stddev");
    const wantAnyOscillator = [
      wantRsi, wantMacd, wantStoch, wantCci, wantWillr, wantAtr, wantAdx, wantObv,
      wantMomentum, wantRoc, wantMfi, wantTrix, wantCmf, wantAroon, wantUo, wantCmo, wantDpo, wantStddev,
    ].some(Boolean);
    volumeSeriesRef.current?.applyOptions({ visible: !wantAnyOscillator });
    rsiSeriesRef.current?.applyOptions({ visible: wantRsi });
    macdSeriesRef.current?.applyOptions({ visible: wantMacd });
    signalSeriesRef.current?.applyOptions({ visible: wantMacd });
    histogramSeriesRef.current?.applyOptions({ visible: wantMacd });
    stochKSeriesRef.current?.applyOptions({ visible: wantStoch });
    stochDSeriesRef.current?.applyOptions({ visible: wantStoch });
    cciSeriesRef.current?.applyOptions({ visible: wantCci });
    willrSeriesRef.current?.applyOptions({ visible: wantWillr });
    atrSeriesRef.current?.applyOptions({ visible: wantAtr });
    adxSeriesRef.current?.applyOptions({ visible: wantAdx });
    obvSeriesRef.current?.applyOptions({ visible: wantObv });
    momentumSeriesRef.current?.applyOptions({ visible: wantMomentum });
    rocSeriesRef.current?.applyOptions({ visible: wantRoc });
    mfiSeriesRef.current?.applyOptions({ visible: wantMfi });
    trixSeriesRef.current?.applyOptions({ visible: wantTrix });
    cmfSeriesRef.current?.applyOptions({ visible: wantCmf });
    aroonUpSeriesRef.current?.applyOptions({ visible: wantAroon });
    aroonDownSeriesRef.current?.applyOptions({ visible: wantAroon });
    uoSeriesRef.current?.applyOptions({ visible: wantUo });
    cmoSeriesRef.current?.applyOptions({ visible: wantCmo });
    dpoSeriesRef.current?.applyOptions({ visible: wantDpo });
    stddevSeriesRef.current?.applyOptions({ visible: wantStddev });
  }, [bottomPane, hasAdvancedChart]);

  // ---- Drive the current candle with live ticker price (rAF-throttled) ----
  // Store latest price in a ref, only flush to chart on animation frames
  useEffect(() => {
    pendingPriceRef.current = livePrice;
  }, [livePrice]);

  // rAF loop: flushes the latest price to the chart at most ~60fps
  useEffect(() => {
    let disposed = false;

    function tick() {
      if (disposed) return;
      rafRef.current = requestAnimationFrame(tick);

      const price = pendingPriceRef.current;
      if (price === undefined || isNaN(price)) return;
      if (!candleSeriesRef.current) return;

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
          candleSeriesRef.current.update({
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
        candleSeriesRef.current.update({
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
  }, [interval]);

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
  }, [tradeMarkers, interval]);

  // ---- Price lines (entry / take-profit / stop-loss / liquidation) ----
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // 清掉旧的价格线
    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    for (const pl of priceLines ?? []) {
      if (!isFinite(pl.price) || pl.price <= 0) continue;
      try {
        const line = series.createPriceLine({
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
  }, [priceLines]);

  return (
    <div className={cn("relative", className)}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/60">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
        </div>
      )}

      {/* Indicators toggle */}
      <div className="absolute left-2 top-2 z-10">
        <button
          onClick={() => setIndicatorsOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1 rounded-xs border px-2 py-1 text-xs backdrop-blur-sm transition-colors",
            hasAdvancedChart
              ? "border-border-default bg-bg-secondary/80 text-text-secondary hover:text-text-primary"
              : "border-gold/30 bg-bg-secondary/80 text-gold"
          )}
        >
          📊 指标 {!hasAdvancedChart && !accessLoading && "🔒"}
        </button>

        {indicatorsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIndicatorsOpen(false)} />
            <div className="absolute left-0 top-9 z-20 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-border-default bg-bg-secondary p-3 text-xs shadow-modal">
              {hasAdvancedChart ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-text-muted">叠加指标（周期可编辑）</p>
                    <button
                      onClick={resetIndicatorParams}
                      className="text-[11px] text-text-muted hover:text-gold"
                      title="恢复全部指标默认周期"
                    >
                      重置周期
                    </button>
                  </div>
                  {OVERLAY_INDICATORS.map(({ toggleKey, label, params }) => (
                    <div key={toggleKey} className="flex items-center justify-between gap-2">
                      <label className="flex flex-1 items-center gap-1.5 overflow-hidden">
                        <input
                          type="checkbox"
                          checked={chartIndicators[toggleKey]}
                          onChange={(e) => setChartIndicators({ [toggleKey]: e.target.checked })}
                        />
                        <span className="truncate text-text-secondary">{label}</span>
                      </label>
                      {params && (
                        <div className="flex shrink-0 items-center gap-1">
                          {params.map(({ key, step }) => (
                            <NumberField
                              key={key}
                              value={indicatorParams[key]}
                              step={step}
                              onChange={(v) => setIndicatorParams({ [key]: v })}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="border-t border-border-default pt-3">
                    <p className="mb-1 text-text-muted">底部副图</p>
                    <div className="grid grid-cols-3 gap-1">
                      {BOTTOM_PANE_INDICATORS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setBottomPane(key)}
                          className={cn(
                            "rounded-xs py-1.5 text-center transition-colors",
                            bottomPane === key ? "bg-bg-primary text-text-primary" : "bg-bg-tertiary text-text-muted hover:text-text-secondary"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Editable period(s) for whichever bottom-pane indicator is currently selected */}
                    {(() => {
                      const active = BOTTOM_PANE_INDICATORS.find((b) => b.key === bottomPane);
                      if (!active?.params) return null;
                      return (
                        <div className="mt-2 flex items-center justify-between rounded-xs bg-bg-tertiary px-2 py-1.5">
                          <span className="text-text-muted">{active.label} 周期</span>
                          <div className="flex items-center gap-1">
                            {active.params.map(({ key, step }) => (
                              <NumberField
                                key={key}
                                value={indicatorParams[key]}
                                step={step}
                                onChange={(v) => setIndicatorParams({ [key]: v })}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-text-secondary">MA 均线、RSI 等高级指标为 Pro 专属功能</p>
                  <Link href={`/${locale}/upgrade`} className="inline-block font-medium text-gold hover:underline">
                    升级 Pro 解锁 →
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div ref={chartRef} className="h-full w-full" />
    </div>
  );
}
