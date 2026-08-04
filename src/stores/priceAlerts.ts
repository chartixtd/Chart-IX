import { create } from "zustand";

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
  loading: boolean;
  fetchAlerts: () => Promise<void>;
  /** 返回是否保存成功——调用方（交易页弹窗）需要据此决定要不要关闭弹窗 */
  addAlert: (symbol: string, targetPrice: number, direction: "above" | "below") => Promise<boolean>;
  removeAlert: (id: string) => Promise<void>;
  /** 把浏览器里存量的本地提醒一次性推到服务端，成功后清空 localStorage */
  migrateLocalAlerts: () => Promise<void>;
}

const LEGACY_KEY = "chart-ix-price-alerts";

interface AlertRow {
  id: string;
  symbol: string;
  target_price: number;
  direction: "above" | "below";
  triggered_at: string | null;
  created_at: string;
}

function toAlert(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    symbol: row.symbol,
    targetPrice: Number(row.target_price),
    direction: row.direction,
    createdAt: new Date(row.created_at).getTime(),
    triggered: row.triggered_at !== null,
  };
}

export const usePriceAlertsStore = create<PriceAlertsState>()((set, get) => ({
  alerts: [],
  loading: false,

  fetchAlerts: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/user/alerts");
      if (!res.ok) return;
      const json = (await res.json()) as { alerts: AlertRow[] };
      set({ alerts: json.alerts.map(toAlert) });
    } finally {
      set({ loading: false });
    }
  },

  addAlert: async (symbol, targetPrice, direction) => {
    const res = await fetch("/api/user/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, targetPrice, direction }),
    });
    if (!res.ok) return false;
    await get().fetchAlerts();
    return true;
  },

  removeAlert: async (id) => {
    // 乐观更新：删除是低风险操作，等一个往返太慢
    set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) }));
    await fetch(`/api/user/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  migrateLocalAlerts: async () => {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { state?: { alerts?: PriceAlert[] } };
      const legacy = (parsed.state?.alerts ?? []).filter((a) => !a.triggered);
      if (legacy.length > 0) {
        const res = await fetch("/api/user/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            migrate: legacy.map((a) => ({
              symbol: a.symbol,
              targetPrice: a.targetPrice,
              direction: a.direction,
            })),
          }),
        });
        // 失败就保留 localStorage，下次登录再试——不能静默丢掉用户设的提醒
        if (!res.ok) return;
      }
      localStorage.removeItem(LEGACY_KEY);
      await get().fetchAlerts();
    } catch {
      // 解析失败说明数据已损坏，直接清掉避免每次登录都重试
      localStorage.removeItem(LEGACY_KEY);
    }
  },
}));
