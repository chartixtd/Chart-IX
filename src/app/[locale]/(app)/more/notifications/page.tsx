"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/client";
import { cn } from "@/lib/utils";

type Prefs = { price_alerts: boolean; screener: boolean; new_content: boolean };
type Heartbeat = { last_run_at: string; last_status: string } | null;

const KEYS: (keyof Prefs)[] = ["price_alerts", "screener", "new_content"];
const LABEL: Record<keyof Prefs, string> = {
  price_alerts: "more_alerts",
  screener: "tab_screener",
  new_content: "tab_learn",
};

export default function NotificationsPage() {
  const t = useTranslations("nav");
  const tPwa = useTranslations("pwa");
  const locale = useLocale();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat>(null);
  const [error, setError] = useState(false);
  // 心跳请求还没返回时不能默认「异常」——未登录用户会拿到 401，
  // heartbeat 停在初始的 null，若不单独跟踪「有没有加载完」就会被下面
  // 的 stale 判断误读成巡检停摆，展示一条从未订阅过的用户看不懂的假警报
  const [heartbeatLoaded, setHeartbeatLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/user/notification-prefs")
      .then((r) => r.json())
      .then((json: { prefs: Prefs; heartbeat: Heartbeat }) => {
        setPrefs(json.prefs);
        setHeartbeat(json.heartbeat);
        setHeartbeatLoaded(true);
      })
      .catch(() => {
        // 请求失败（网络错误等）同样不能默认「异常」——保持 heartbeatLoaded
        // 为 false，banner 就不会渲染，而不是渲染一条误导性的假警报
      });
  }, []);

  const toggle = useCallback(
    async (key: keyof Prefs) => {
      if (!prefs) return;
      const prev = prefs;
      const next = { ...prefs, [key]: !prefs[key] };
      setPrefs(next);
      setError(false);

      // 从「全关」变成「有开」时才需要真正建立推送订阅
      const hadAny = KEYS.some((k) => prev[k]);
      const hasAny = KEYS.some((k) => next[k]);

      if (!hadAny && hasAny) {
        const result = await subscribeToPush(locale);
        if (result !== "ok") {
          // 订阅失败——不能把偏好悄悄设成「已开启」，否则用户以为提醒在跑，
          // 实际上什么都不会推送。回滚 UI，显式告诉用户。
          setPrefs(prev);
          setError(true);
          return;
        }
      }
      if (hadAny && !hasAny) await unsubscribeFromPush();

      const res = await fetch("/api/user/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        // PUT 失败同理：不能让 UI 和数据库的状态悄悄分叉。
        setPrefs(prev);
        setError(true);
      }
    },
    [prefs, locale]
  );

  // 心跳超过 5 分钟没更新就认为巡检停了。静默失效比报错糟糕得多，
  // 用户有权知道自己依赖的功能还活着没有。
  const stale =
    heartbeatLoaded &&
    (!heartbeat ||
      heartbeat.last_status !== "ok" ||
      Date.now() - new Date(heartbeat.last_run_at).getTime() > 5 * 60 * 1000);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-2xl tracking-tighter text-text-primary">
        {t("more_notifications")}
      </h1>

      {heartbeatLoaded && (
        <p
          className={cn(
            "mt-4 rounded-xs border px-3 py-2 text-xs",
            stale
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-success/30 bg-success-bg text-success"
          )}
        >
          {stale ? tPwa("service_status_stale") : tPwa("service_status_ok")}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xs border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
          {tPwa("push_error")}
        </p>
      )}

      {prefs && (
        <ul className="mt-6 divide-y divide-border-default border-y border-border-default">
          {KEYS.map((key) => (
            <li key={key} className="flex items-center justify-between py-4">
              <span className="text-sm text-text-primary">{t(LABEL[key])}</span>
              <button
                onClick={() => void toggle(key)}
                role="switch"
                aria-checked={prefs[key]}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                  prefs[key] ? "bg-gold" : "bg-bg-hover"
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-5 w-5 rounded-full bg-bg-primary transition-transform",
                    prefs[key] ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
