import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradeMarketType = "spot" | "paper" | "futures";
export type TradeRightTab = "trade" | "orders" | "book";

/** Mutually-exclusive bottom-pane chart indicator. */
export type ChartBottomPane =
  | "volume" | "rsi" | "macd" | "stoch" | "cci" | "willr" | "atr" | "adx" | "obv"
  | "momentum" | "roc" | "mfi" | "trix" | "cmf" | "aroon" | "uo" | "cmo" | "dpo" | "stddev";

export interface ChartIndicatorSettings {
  showMA: boolean;
  showEMA: boolean;
  showBB: boolean;
  showVWAP: boolean;
  showSAR: boolean;
  showVWMA: boolean;
  showKC: boolean;
  showDonchian: boolean;
  showSuperTrend: boolean;
  showDEMA: boolean;
  showTEMA: boolean;
  showEnvelope: boolean;
  showIchimoku: boolean;
  bottomPane: ChartBottomPane;
}

export const DEFAULT_CHART_INDICATORS: ChartIndicatorSettings = {
  showMA: false,
  showEMA: false,
  showBB: false,
  showVWAP: false,
  showSAR: false,
  showVWMA: false,
  showKC: false,
  showDonchian: false,
  showSuperTrend: false,
  showDEMA: false,
  showTEMA: false,
  showEnvelope: false,
  showIchimoku: false,
  bottomPane: "volume",
};

/** Every user-editable indicator period/multiplier, flat so the settings UI can render generically. */
export interface ChartIndicatorParams {
  maPeriod1: number;
  maPeriod2: number;
  emaPeriod1: number;
  emaPeriod2: number;
  bbPeriod: number;
  bbMultiplier: number;
  vwmaPeriod: number;
  sarStep: number;
  sarMax: number;
  kcPeriod: number;
  kcAtrPeriod: number;
  kcMultiplier: number;
  donchianPeriod: number;
  superTrendPeriod: number;
  superTrendMultiplier: number;
  demaPeriod: number;
  temaPeriod: number;
  envelopePeriod: number;
  envelopePercent: number;
  ichimokuTenkan: number;
  ichimokuKijun: number;
  ichimokuSenkouB: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  stochKPeriod: number;
  stochDPeriod: number;
  cciPeriod: number;
  willrPeriod: number;
  atrPeriod: number;
  adxPeriod: number;
  momentumPeriod: number;
  rocPeriod: number;
  mfiPeriod: number;
  trixPeriod: number;
  cmfPeriod: number;
  aroonPeriod: number;
  uoPeriod1: number;
  uoPeriod2: number;
  uoPeriod3: number;
  cmoPeriod: number;
  dpoPeriod: number;
  stddevPeriod: number;
}

export const DEFAULT_CHART_INDICATOR_PARAMS: ChartIndicatorParams = {
  maPeriod1: 7,
  maPeriod2: 25,
  emaPeriod1: 12,
  emaPeriod2: 26,
  bbPeriod: 20,
  bbMultiplier: 2,
  vwmaPeriod: 20,
  sarStep: 0.02,
  sarMax: 0.2,
  kcPeriod: 20,
  kcAtrPeriod: 10,
  kcMultiplier: 2,
  donchianPeriod: 20,
  superTrendPeriod: 10,
  superTrendMultiplier: 3,
  demaPeriod: 20,
  temaPeriod: 20,
  envelopePeriod: 20,
  envelopePercent: 2.5,
  ichimokuTenkan: 9,
  ichimokuKijun: 26,
  ichimokuSenkouB: 52,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  stochKPeriod: 14,
  stochDPeriod: 3,
  cciPeriod: 20,
  willrPeriod: 14,
  atrPeriod: 14,
  adxPeriod: 14,
  momentumPeriod: 10,
  rocPeriod: 12,
  mfiPeriod: 14,
  trixPeriod: 15,
  cmfPeriod: 20,
  aroonPeriod: 25,
  uoPeriod1: 7,
  uoPeriod2: 14,
  uoPeriod3: 28,
  cmoPeriod: 14,
  dpoPeriod: 20,
  stddevPeriod: 20,
};

/** Common intervals pinned to the always-visible row; the rest live in the "更多" overflow. */
export const DEFAULT_PINNED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

interface TradePrefsState {
  symbol: string;
  interval: string;
  market: TradeMarketType;
  rightTab: TradeRightTab;
  pinnedIntervals: string[];
  chartIndicators: ChartIndicatorSettings;
  indicatorParams: ChartIndicatorParams;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  setMarket: (market: TradeMarketType) => void;
  setRightTab: (tab: TradeRightTab) => void;
  togglePinnedInterval: (interval: string) => void;
  setChartIndicators: (patch: Partial<ChartIndicatorSettings>) => void;
  setIndicatorParams: (patch: Partial<ChartIndicatorParams>) => void;
  resetIndicatorParams: () => void;
}

export const useTradePrefsStore = create<TradePrefsState>()(
  persist(
    (set) => ({
      symbol: "BTC-USDT",
      interval: "1h",
      market: "spot",
      rightTab: "trade",
      pinnedIntervals: DEFAULT_PINNED_INTERVALS,
      chartIndicators: DEFAULT_CHART_INDICATORS,
      indicatorParams: DEFAULT_CHART_INDICATOR_PARAMS,
      setSymbol: (symbol) => set({ symbol }),
      setInterval: (interval) => set({ interval }),
      setMarket: (market) => set({ market }),
      setRightTab: (rightTab) => set({ rightTab }),
      togglePinnedInterval: (interval) =>
        set((s) => ({
          pinnedIntervals: s.pinnedIntervals.includes(interval)
            ? s.pinnedIntervals.filter((i) => i !== interval)
            : [...s.pinnedIntervals, interval],
        })),
      setChartIndicators: (patch) =>
        set((s) => ({ chartIndicators: { ...s.chartIndicators, ...patch } })),
      setIndicatorParams: (patch) =>
        set((s) => ({ indicatorParams: { ...s.indicatorParams, ...patch } })),
      resetIndicatorParams: () => set({ indicatorParams: DEFAULT_CHART_INDICATOR_PARAMS }),
    }),
    {
      name: "chart-ix-trade-prefs",
      // Merge persisted state onto the current defaults instead of replacing
      // wholesale, so a new field added to ChartIndicatorParams/Settings after
      // a user last saved doesn't come back as `undefined` and break math.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TradePrefsState>;
        return {
          ...current,
          ...p,
          chartIndicators: { ...current.chartIndicators, ...p.chartIndicators },
          indicatorParams: { ...current.indicatorParams, ...p.indicatorParams },
        };
      },
    }
  )
);
