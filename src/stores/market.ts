import { create } from "zustand";
import type { BingXTicker } from "@/types/bingx";

interface MarketState {
  /** symbol → latest ticker data from WebSocket */
  tickers: Record<string, BingXTicker>;
  /** WebSocket connection state */
  wsConnected: boolean;
  /** batch update from REST or WebSocket bulk push */
  setTickers: (tickers: BingXTicker[]) => void;
  /** single ticker update */
  setTicker: (symbol: string, ticker: BingXTicker) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  tickers: {},
  wsConnected: false,

  setTickers: (tickers) =>
    set((state) => {
      const next = { ...state.tickers };
      for (const t of tickers) {
        next[t.symbol] = t;
      }
      return { tickers: next };
    }),

  setTicker: (symbol, ticker) =>
    set((state) => ({
      tickers: { ...state.tickers, [symbol]: ticker },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
