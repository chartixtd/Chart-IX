"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  deriveSwitchState,
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

  // 意愿与设备能力的拆分规则住在 lib/push/client.ts 的 deriveSwitchState 里，
  // 那里是纯函数、有单测——这段逻辑刚在线上把一个开关变成了点不动的死结，
  // 值得被钉住而不是散在组件里
  const { on, interactive, deliverable } = deriveSwitchState(
    Boolean(prefs?.screener),
    state,
    prefs !== null
  );

  const toggle = useCallback(async () => {
    if (!prefs || busy) return;
    // 只有打开这个方向需要设备能力
    if (!on && state?.kind !== "ready") return;
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
          {/* prefs 为 null = 首次挂载还没读到偏好那一瞬间。这里必须跟「已确认
              是关」区分开：此前没有加载态，開关在这段空窗期直接按 on=false
              渲染——用户看到的是「先闪一下关，读完才变成开」，会被当成
              「关闭又打开」的证据，其实只是还没读到数据。骨架屏诚实地说
              「还不知道」，而不是抢先给一个可能是错的答案。 */}
          {prefs === null ? (
            <Skeleton className="h-7 w-12 rounded-full" />
          ) : (
            <button
              type="button"
              onClick={() => void toggle()}
              role="switch"
              aria-checked={on}
              aria-label={t("notifications_scanner")}
              disabled={!interactive || busy}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                // 与 Button 的 disabled 保持一致；40 在这个深色轨道上压得太狠
                "disabled:cursor-not-allowed disabled:opacity-50",
                on ? "bg-gold" : "bg-bg-hover"
              )}
            >
              {/* 滑块颜色必须跟着状态走，不能两态共用一个色值。
                  轨道打开时是金色 #C9A24B、关闭时是 #262117，两者一亮一暗：
                  深色滑块 #0B0A08 在金色上有 8.25:1，在深色轨道上只有 1.24:1
                  （字面意义的看不见——这就是它此前的样子）；反过来浅色滑块
                  在深色轨道上 6.10:1，在金色上却只有 1.09:1。没有哪个单一颜色
                  能同时站住，所以两态各用各的。 */}
              <span
                className={cn(
                  // left-0 不能省：<button> 浏览器默认 text-align: center，
                  // 绝对定位元素没写 left 时会退回按这个居中的「静态位置」
                  // 计算落点，叠加 translate-x 之后滑块会跑到偏离预期的地方。
                  // 必须是 left-0 而不是 left-1——水平方向靠位移产生边距：
                  // translate-x-1（关，4px）与 translate-x-6（开，24px）已经
                  // 是以 left:0 为基准算出来的对称值（关态离左 4px，开态离右
                  // 48-24-20=4px，跟 top-1 的垂直 4px 边距一致）。left-1 会把
                  // 这 4px 边距在关态叠加成 8px，跑偏只是换了个地方。
                  // 这套写法是从更早就存在的旧页面原样搬过来的（该页面从未
                  // 有过入口，所以这个 bug 从来没被人看见过），仓库里另一处
                  // 开关（TelegramPushEditor.tsx）写对了、显式给了 left。
                  "absolute left-0 top-1 h-5 w-5 rounded-full transition-transform",
                  on ? "translate-x-6 bg-bg-primary" : "translate-x-1 bg-text-secondary"
                )}
              />
            </button>
          )}
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

        {/* 三种「用不了」各说各的。合成一句「浏览器不支持」的代价是真实发生过的：
            漏配 VAPID 公钥时，看起来像浏览器的问题而实际是构建配置的问题。 */}
        {state?.kind === "no-vapid-key" && (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {tPwa("push_no_vapid")}
          </p>
        )}

        {state?.kind === "no-service-worker" && (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {tPwa("push_no_service_worker")}
          </p>
        )}

        {state?.kind === "unsupported" && (
          <p className="text-xs leading-relaxed text-text-muted">{tPwa("push_unsupported")}</p>
        )}

        {/* 偏好开着、设备也够格，却没有浏览器订阅。resubscribeIfNeeded 在挂载时
            会静默补，补不上才会走到这里（上一次 POST 失败等）。上面那些分支都
            不成立，不给这一句的话开关就是「开着但什么都不会来」——正是这个组件
            要消灭的那种沉默。关掉再打开会走完整的重新订阅，用户自己能修。 */}
        {on && state?.kind === "ready" && !state.subscribed && (
          <p className="rounded-xs border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning">
            {t("notifications_test_stale")}
          </p>
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

        {/* 按 deliverable 而不是 on：偏好开着但设备送不到时，这个按钮必然报错，
            而它报的错解释不了真正的原因——那句原因已经在上面的分支里说了 */}
        {deliverable && (
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
