import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradeMarketType = "spot" | "paper" | "futures";
export type TradeRightTab = "trade" | "orders" | "book";

/**
 * Chart indicator state used to live here as boolean flags plus a flat param
 * object. It now lives in `stores/chartStore.ts` as a list of configured
 * instances (see `migrateLegacyIndicators` there for how old saves are carried
 * over). Any leftover `chartIndicators`/`indicatorParams` keys in persisted
 * storage are intentionally left untouched so that migration can still read them.
 */

/** Common intervals pinned to the always-visible row; the rest live in the "更多" overflow. */
export const DEFAULT_PINNED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

interface TradePrefsState {
  symbol: string;
  interval: string;
  market: TradeMarketType;
  rightTab: TradeRightTab;
  pinnedIntervals: string[];
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  setMarket: (market: TradeMarketType) => void;
  setRightTab: (tab: TradeRightTab) => void;
  togglePinnedInterval: (interval: string) => void;
}

export const useTradePrefsStore = create<TradePrefsState>()(
  persist(
    (set) => ({
      symbol: "BTC-USDT",
      interval: "1h",
      market: "spot",
      rightTab: "trade",
      pinnedIntervals: DEFAULT_PINNED_INTERVALS,
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
    }),
    {
      name: "chart-ix-trade-prefs",
      // Spread persisted state over the current defaults so a newly added field
      // doesn't come back as `undefined` for users who saved before it existed.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TradePrefsState>;
        return { ...current, ...p };
      },
    }
  )
);
