import { create } from "zustand";
import type { BingXTicker, BingXKline } from "@/types/bingx";

interface MarketState {
  /** symbol → latest ticker data from WebSocket */
  tickers: Record<string, BingXTicker>;
  /** "symbol:interval" → latest kline candle from WebSocket */
  klines: Record<string, BingXKline>;
  /** WebSocket connection state */
  wsConnected: boolean;
  /** batch update from REST or WebSocket bulk push */
  setTickers: (tickers: BingXTicker[]) => void;
  /** single ticker update */
  setTicker: (symbol: string, ticker: BingXTicker) => void;
  /** update latest kline candle */
  setKline: (symbol: string, interval: string, kline: BingXKline) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  tickers: {},
  klines: {},
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

  setKline: (symbol, interval, kline) =>
    set((state) => ({
      klines: { ...state.klines, [`${symbol}:${interval}`]: kline },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
