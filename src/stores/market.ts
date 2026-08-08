import { create } from "zustand";
import type { BingXTicker, BingXDepth } from "@/types/bingx";

interface MarketState {
  /** symbol → latest ticker data from WebSocket */
  tickers: Record<string, BingXTicker>;
  /** symbol → 最新盘口快照（WebSocket 推送） */
  depths: Record<string, { book: BingXDepth; at: number }>;
  /** WebSocket connection state */
  wsConnected: boolean;
  /** batch update from REST or WebSocket bulk push */
  setTickers: (tickers: BingXTicker[]) => void;
  /** single ticker update */
  setTicker: (symbol: string, ticker: BingXTicker) => void;
  setDepth: (symbol: string, book: BingXDepth) => void;
  /** 退订时清理——tickers/depths 只增不删会让"是否有行情"类判断永久为真 */
  removeTicker: (symbol: string) => void;
  removeDepth: (symbol: string) => void;
  /** 断线时整体清空——重连前 depths 里全是陈旧快照，留着会被 useOrderBook 误当作"仍在实时推送"而静默展示 */
  clearDepths: () => void;
  setWsConnected: (connected: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  tickers: {},
  depths: {},
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

  setDepth: (symbol, book) =>
    set((state) => ({ depths: { ...state.depths, [symbol]: { book, at: Date.now() } } })),

  removeTicker: (symbol) =>
    set((state) => {
      if (!(symbol in state.tickers)) return state; // 无变化时返回同一引用，避免多余重渲染
      const next = { ...state.tickers };
      delete next[symbol];
      return { tickers: next };
    }),

  removeDepth: (symbol) =>
    set((state) => {
      if (!(symbol in state.depths)) return state;
      const next = { ...state.depths };
      delete next[symbol];
      return { depths: next };
    }),

  clearDepths: () =>
    set((state) => (Object.keys(state.depths).length === 0 ? state : { depths: {} })),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
