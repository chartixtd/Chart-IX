import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  createdAt: number;
  triggered: boolean;
}

interface PriceAlertsState {
  alerts: PriceAlert[];
  addAlert: (symbol: string, targetPrice: number, direction: "above" | "below") => void;
  removeAlert: (id: string) => void;
  markTriggered: (id: string) => void;
  clearTriggered: () => void;
}

export const usePriceAlertsStore = create<PriceAlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      addAlert: (symbol, targetPrice, direction) =>
        set((state) => ({
          alerts: [
            ...state.alerts,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              symbol,
              targetPrice,
              direction,
              createdAt: Date.now(),
              triggered: false,
            },
          ],
        })),
      removeAlert: (id) => set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),
      markTriggered: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) => (a.id === id ? { ...a, triggered: true } : a)),
        })),
      clearTriggered: () => set((state) => ({ alerts: state.alerts.filter((a) => !a.triggered) })),
    }),
    { name: "chart-ix-price-alerts" }
  )
);
