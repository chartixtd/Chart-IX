import { create } from "zustand";

interface PwaState {
  /** 新版本 SW 已就绪、正在 waiting */
  updateReady: boolean;
  /** 交易页有未确认订单时，不打扰用户去 reload */
  hasPendingOrder: boolean;
  setUpdateReady: (v: boolean) => void;
  setHasPendingOrder: (v: boolean) => void;
  /** 由 ServiceWorkerRegistrar 注入，UpdateBanner 调用 */
  applyUpdate: () => void;
  registerApplyUpdate: (fn: () => void) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateReady: false,
  hasPendingOrder: false,
  setUpdateReady: (v) => set({ updateReady: v }),
  setHasPendingOrder: (v) => set({ hasPendingOrder: v }),
  applyUpdate: () => {},
  registerApplyUpdate: (fn) => set({ applyUpdate: fn }),
}));

/**
 * 清掉页面缓存分区。cix-pages 里存的是渲染好的 HTML，仪表盘和订单页
 * 含用户数据——共用手机的场景下，登出后不清是实际的隐私问题。
 */
export async function purgePageCache(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "PURGE_PAGES" });
}
