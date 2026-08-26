"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  readPushState,
  resubscribeIfNeeded,
  subscribeToPush,
  type PushState,
} from "@/lib/push/client";
import { cn } from "@/lib/utils";

/** PUT 的 body 仍是三个键的完整对象——UI 只暴露 screener，但不能把另外两个抹掉 */
type Prefs = { price_alerts: boolean; screener: boolean; new_content: boolean };
type Notice = { tone: "ok" | "bad"; text: string } | null;

/** 点一次测试之后按钮禁用多久。够用户看一眼通知栏，也挡住连点。 */
const TEST_COOLDOWN_MS = 30_000;

/**
 * 设置页的通知区块。
 *
 * 这里的核心规则是把**设备级的浏览器订阅**和**用户级的通知偏好**分开对待：
 *
 * - 开：必须先真的拿到浏览器订阅，成功了才写偏好。顺序反过来就是这个功能
 *   一直以来的 bug——数据库说「已开启」而浏览器根本没订阅过，用户永远收不到，
 *   而页面上没有任何东西提示这件事。
 * - 关：只写偏好，**不退订**。push_subscriptions 是一台设备一行、三类通知
 *   共用，退订会连带把到价提醒也废掉。留着一行 screener=false 的订阅成本是
 *   零——getOptedInSubscriptions 先按偏好表筛 user_id，这个用户根本不在结果集里。
 *
 * 显示态也不直接用数据库那个布尔值：偏好开着但权限被撤/订阅丢了的时候，
 * 「显示为开」就是在骗人。三段全通才算开。
 */
export function NotificationSettings() {
  const t = useTranslations("settings");
  const tPwa = useTranslations("pwa");
  const locale = useLocale();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/user/notification-prefs").catch(() => null);
      const json = res?.ok ? ((await res.json().catch(() => null)) as { prefs: Prefs } | null) : null;
      // iOS 清了存储之后浏览器订阅会消失而权限还在。先静默补回来再读状态，
      // 否则开关会显示成「关」，而用户从来没关过它。
      await resubscribeIfNeeded(locale);
      const next = await readPushState();
      if (!alive) return;
      if (json?.prefs) {
        setPrefs(json.prefs);
      } else {
        // GET 失败时不能把 prefs 留在 null——interactive 恒为 false，开关
        // 永久禁用，而 state 多半是 ready，三块降级说明一条都不触发，用户
        // 面对一个死掉的开关、零文案。退回与服务端 GET 无行分支逐字一致的
        // 默认值兜底，开关至少可点：点了会走完整订阅 + PUT，PUT 自己会把
        // 偏好行建出来。同时用 notice 明说这次没读到偏好，不能悄悄挺过去。
        setPrefs({ price_alerts: true, screener: false, new_content: true });
        setNotice({ tone: "bad", text: tPwa("push_error") });
      }
      setState(next);
    })();
    return () => {
      alive = false;
    };
    // tPwa 故意不进依赖数组：这是一次挂载 + locale 变化时才跑的效果，
    // next-intl 的 translator 函数每次渲染都可能拿到新引用，纳入依赖会让
    // 这个效果在每次 setNotice/setState 触发的重渲染后又跑一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (!cooling) return;
    const id = setTimeout(() => setCooling(false), TEST_COOLDOWN_MS);
    return () => clearTimeout(id);
  }, [cooling]);

  // 三段全通才算开。偏好开着但权限被撤或订阅丢了，显示为开就是在骗人。
  const on = Boolean(prefs?.screener) && state?.kind === "ready" && state.subscribed;
  const interactive = state?.kind === "ready" && prefs !== null;

  const toggle = useCallback(async () => {
    if (!prefs || state?.kind !== "ready" || busy) return;
    setBusy(true);
    setNotice(null);

    if (!on) {
      // subscribeToPush 是幂等的：已有订阅就复用，无论如何都会 POST 给服务端。
      // 必须先它成功，再写偏好。
      const result = await subscribeToPush(locale);
      if (result !== "ok") {
        setNotice({
          tone: "bad",
          text:
            result === "denied"
              ? tPwa("push_denied")
              : result === "unsupported"
                ? tPwa("push_unsupported")
                : tPwa("push_error"),
        });
        setState(await readPushState());
        setBusy(false);
        return;
      }
    }

    const next: Prefs = { ...prefs, screener: !on };
    const res = await fetch("/api/user/notification-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);

    if (!res?.ok) {
      // PUT 失败不能让 UI 和数据库悄悄分叉——保持原样并说出来
      setNotice({ tone: "bad", text: tPwa("push_error") });
      setBusy(false);
      return;
    }

    setPrefs(next);
    setState(await readPushState());
    setBusy(false);
  }, [prefs, state, busy, on, locale, tPwa]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    const json = res
      ? ((await res.json().catch(() => null)) as { sent?: number; error?: string } | null)
      : null;

    if (res?.ok) {
      // sent === 0 说明 send.ts 刚按 404/410 把失效端点删掉了。关掉再打开
      // 会走完整的重新订阅，这是用户自己能做的修复。
      setNotice(
        (json?.sent ?? 0) > 0
          ? { tone: "ok", text: t("notifications_test_sent") }
          : { tone: "bad", text: t("notifications_test_stale") }
      );
    } else if (json?.error === "no_subscription") {
      setNotice({ tone: "bad", text: t("notifications_test_stale") });
    } else if (res?.status === 401) {
      // 内部错误码，不能原样显示给用户
      setNotice({ tone: "bad", text: t("please_login") });
    } else if (res?.status === 429) {
      // 服务端限流的内部错误码（"rate_limited"），同样不能原样显示
      setNotice({ tone: "bad", text: t("notifications_test_cooldown") });
    } else {
      // 其余情况原样回显服务端消息——VAPID 变量缺失时 sendToSubscriptions
      // 抛的是一句明确的中文错误，那是「为什么收不到」最有用的答案，
      // 这个兜底是有意的，不要连它一起改掉
      setNotice({ tone: "bad", text: json?.error ?? tPwa("push_error") });
    }

    setBusy(false);
    setCooling(true);
  }, [t, tPwa]);

  return (
    <Card className="mt-6" padding="lg">
      <h2 className="font-display text-lg font-semibold tracking-tight text-text-primary">
        {t("notifications")}
      </h2>

      <div className="mt-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-text-primary">{t("notifications_scanner")}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {t("notifications_scanner_desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggle()}
            role="switch"
            aria-checked={on}
            aria-label={t("notifications_scanner")}
            disabled={!interactive || busy}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-40",
              on ? "bg-gold" : "bg-bg-hover"
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-5 w-5 rounded-full bg-bg-primary transition-transform",
                on ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>

        {/* iOS 上没装到主屏时 Notification API 压根不存在。给死路文案不如给出路。 */}
        {state?.kind === "ios-install-first" && (
          <div className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            <p>{tPwa("push_ios_install_first")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>{tPwa("install_ios_step1")}</li>
              <li>{tPwa("install_ios_step2")}</li>
              <li>{tPwa("install_ios_step3")}</li>
            </ol>
          </div>
        )}

        {state?.kind === "denied" && (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {tPwa("push_denied")}
          </p>
        )}

        {state?.kind === "unsupported" && (
          <p className="text-xs leading-relaxed text-text-muted">{tPwa("push_unsupported")}</p>
        )}

        {notice && (
          <p
            className={cn(
              "rounded-xs border px-3 py-2 text-xs leading-relaxed",
              notice.tone === "ok"
                ? "border-success/30 bg-success-bg text-success"
                : "border-danger/30 bg-danger-bg text-danger"
            )}
          >
            {notice.text}
          </p>
        )}

        {/* 只在真的订阅上了才显示——开关是关的时候，这个按钮必然报错 */}
        {on && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sendTest()}
            loading={busy}
            disabled={cooling}
            className="w-full sm:w-auto"
          >
            {t("notifications_test")}
          </Button>
        )}
      </div>
    </Card>
  );
}
