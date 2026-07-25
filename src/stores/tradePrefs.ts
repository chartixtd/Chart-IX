import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TradeMarketType = "spot" | "paper" | "futures";
export type TradeRightTab = "trade" | "orders" | "book";

interface TradePrefsState {
  symbol: string;
  interval: string;
  market: TradeMarketType;
  rightTab: TradeRightTab;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  setMarket: (market: TradeMarketType) => void;
  setRightTab: (tab: TradeRightTab) => void;
}

export const useTradePrefsStore = create<TradePrefsState>()(
  persist(
    (set) => ({
      symbol: "BTC-USDT",
      interval: "1h",
      market: "spot",
      rightTab: "trade",
      setSymbol: (symbol) => set({ symbol }),
      setInterval: (interval) => set({ interval }),
      setMarket: (market) => set({ market }),
      setRightTab: (rightTab) => set({ rightTab }),
    }),
    { name: "chart-ix-trade-prefs" }
  )
);
