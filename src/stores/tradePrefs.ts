import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradeMarketType = "spot" | "paper" | "futures";
export type TradeRightTab = "trade" | "orders" | "book";

/** Mutually-exclusive bottom-pane chart indicator. */
export type ChartBottomPane =
  | "volume" | "rsi" | "macd" | "stoch" | "cci" | "willr" | "atr" | "adx" | "obv"
  | "momentum" | "roc" | "mfi" | "trix";

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
  bottomPane: "volume",
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
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  setMarket: (market: TradeMarketType) => void;
  setRightTab: (tab: TradeRightTab) => void;
  togglePinnedInterval: (interval: string) => void;
  setChartIndicators: (patch: Partial<ChartIndicatorSettings>) => void;
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
    }),
    { name: "chart-ix-trade-prefs" }
  )
);
