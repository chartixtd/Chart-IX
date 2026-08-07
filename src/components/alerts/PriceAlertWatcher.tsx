"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePriceAlertsStore } from "@/stores/priceAlerts";
import { resubscribeIfNeeded } from "@/lib/push/client";

// Survives PriceAlertWatcher remounts on route-group crossings (dashboard ->
// articles unmounts AppChrome and everything under it). Without this, every
// such crossing would re-run the local-alert migration and re-POST to
// /api/push/subscribe for a user who already has notification permission
// granted. Keyed by `${userId}:${locale}` — a real locale switch (via the
// language switcher) still refreshes the push subscription's locale, only a
// remount with the exact same user+locale is skipped. Reset on sign-out so a
// genuine re-login re-syncs. Same SSR discipline as AuthProvider's
// lastKnownAuth: never read/write this on the server.
let syncedKey: string | null = null;

/**
 * 服务端是价格提醒的唯一权威——触发判定在 /api/cron/price-alerts 里做。
 * 这里只负责：登录后拉一次列表、迁移存量本地提醒、补订丢失的推送订阅，
 * 以及在 service worker 收到推送时刷新列表让铃铛角标跟上。
 *
 * 此前这个组件自己监听行情做触发判定；两边都判会让逻辑迟早漂移。
 */
export function PriceAlertWatcher() {
  const auth = useAuth();
  const locale = useLocale();
  const fetchAlerts = usePriceAlertsStore((s) => s.fetchAlerts);
  const migrateLocalAlerts = usePriceAlertsStore((s) => s.migrateLocalAlerts);

  useEffect(() => {
    if (!auth.userId) {
      syncedKey = null;
      return;
    }
    const key = `${auth.userId}:${locale}`;
    if (syncedKey === key) return; // already synced this user+locale in this tab session
    syncedKey = key;
    void migrateLocalAlerts().then(() => fetchAlerts());
    // iOS 清了存储之后订阅会连同登录态一起丢。权限还在的话静默补订，
    // 不打扰用户——否则提醒会安静地再也不响。
    void resubscribeIfNeeded(locale);
  }, [auth.userId, locale, fetchAlerts, migrateLocalAlerts]);

  useEffect(() => {
    if (!auth.userId || typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED") void fetchAlerts();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [auth.userId, fetchAlerts]);

  return null;
}
