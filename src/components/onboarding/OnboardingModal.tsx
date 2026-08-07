"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Level = "beginner" | "experienced";

const TOUR_ITEMS = [
  { icon: "🧭", title: "学习路径", desc: "循序渐进的课程，跟着走就能建立完整的交易基础" },
  { icon: "📈", title: "模拟盘", desc: "零风险的虚拟资金，练熟了再考虑用真钱交易" },
  { icon: "⭐", title: "自选行情", desc: "收藏常看的币种，实时价格一目了然" },
  { icon: "🏠", title: "我的主页", desc: "随时回来查看学习进度、模拟盘战绩和最新内容" },
];

interface OnboardingSessionState {
  userId: string;
  step: number;
  level: Level | null;
}

// Survives OnboardingModal remounts on route-group crossings — the "浏览学习
// 路径" link below navigates from (app) to (static), which unmounts AppChrome
// (and this modal with it). Without this, the remounted modal would forget
// which step/level the user had picked and the onboarding_completed-is-still-
// false re-check would bounce them back to the step-0 welcome screen. Keyed
// by userId so a genuine account switch in the same tab still starts fresh.
// Same SSR discipline as AuthProvider's lastKnownAuth: never read/write this
// on the server — it's a process-level singleton shared across requests.
let sessionState: OnboardingSessionState | null = null;

export function OnboardingModal() {
  const auth = useAuth();
  const locale = useLocale();

  const [shouldShow, setShouldShow] = useState(false);
  const [step, setStepState] = useState(() =>
    typeof window !== "undefined" && sessionState?.userId === auth.userId ? sessionState.step : 0
  );
  const [level, setLevelState] = useState<Level | null>(() =>
    typeof window !== "undefined" && sessionState?.userId === auth.userId ? sessionState.level : null
  );
  const [saving, setSaving] = useState(false);

  // Reads the current module-level snapshot rather than closed-over render
  // state, so two persist() calls in the same click handler (e.g. setLevel(l)
  // immediately followed by setStep(1)) compose instead of the second call
  // clobbering the first with a stale value.
  const persistSession = (patch: Partial<Pick<OnboardingSessionState, "step" | "level">>) => {
    if (typeof window === "undefined" || !auth.userId) return;
    const prev =
      sessionState?.userId === auth.userId ? sessionState : { userId: auth.userId, step: 0, level: null };
    sessionState = { ...prev, ...patch };
  };
  const setStep = (next: number) => {
    setStepState(next);
    persistSession({ step: next });
  };
  const setLevel = (next: Level) => {
    setLevelState(next);
    persistSession({ level: next });
  };

  useEffect(() => {
    if (!auth.userId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("users")
      .select("onboarding_completed")
      .eq("id", auth.userId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data && data.onboarding_completed === false) {
          setShouldShow(true);
        }
      });
    return () => { cancelled = true; };
  }, [auth.userId]);

  const finish = async () => {
    if (!auth.userId) return;
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("users")
      .update({ onboarding_completed: true, experience_level: level })
      .eq("id", auth.userId);
    setSaving(false);
    setShouldShow(false);
    // Onboarding is done — nothing left to restore across a future remount.
    if (typeof window !== "undefined" && sessionState?.userId === auth.userId) {
      sessionState = null;
    }
  };

  if (!shouldShow) return null;

  return (
    <Modal open={shouldShow} onClose={finish} title={undefined} size="md">
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary">欢迎来到 Chart-IX 👋</h2>
          <p className="mt-2 text-sm text-text-secondary">先告诉我们你的交易经验，我们会给你更合适的建议。</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["beginner", "experienced"] as Level[]).map((l) => (
              <button
                key={l}
                onClick={() => { setLevel(l); setStep(1); }}
                className={cn(
                  "rounded-md border p-4 text-left transition-colors hover:border-gold/50 hover:bg-gold/5",
                  level === l ? "border-gold bg-gold/10" : "border-border-default"
                )}
              >
                <div className="text-2xl">{l === "beginner" ? "🌱" : "📊"}</div>
                <div className="mt-2 text-sm font-medium text-text-primary">
                  {l === "beginner" ? "完全新手" : "有一些经验"}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {l === "beginner" ? "第一次接触加密货币交易" : "懂一些基础，想更系统地学习"}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-5 text-right">
            <button onClick={finish} className="text-xs text-text-muted hover:text-text-secondary">跳过引导</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {level === "beginner" ? "从这里开始最合适" : "你可以直接上手"}
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            {level === "beginner"
              ? "建议先跟着学习路径打好基础，再去模拟盘练手，完全不涉及真实资金。"
              : "可以直接去模拟盘熟悉一下界面和操作，也欢迎顺便看看我们的课程内容。"}
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link href={`/${locale}/learn`} onClick={() => setStep(2)}>
              <div className="rounded-md border border-border-default p-4 text-left hover:border-gold/50 hover:bg-gold/5">
                <div className="text-2xl">🧭</div>
                <div className="mt-2 text-sm font-medium text-text-primary">浏览学习路径</div>
              </div>
            </Link>
            <Link href={`/${locale}/trade`} onClick={() => setStep(2)}>
              <div className="rounded-md border border-border-default p-4 text-left hover:border-gold/50 hover:bg-gold/5">
                <div className="text-2xl">📈</div>
                <div className="mt-2 text-sm font-medium text-text-primary">去模拟盘看看</div>
              </div>
            </Link>
          </div>
          <div className="mt-5 flex justify-between">
            <button onClick={() => setStep(0)} className="text-xs text-text-muted hover:text-text-secondary">← 上一步</button>
            <Button size="sm" variant="ghost" onClick={() => setStep(2)}>下一步</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary">快速了解一下</h2>
          <div className="mt-4 space-y-3">
            {TOUR_ITEMS.map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="text-xl">{item.icon}</span>
                <div>
                  <p className="text-sm font-medium text-text-primary">{item.title}</p>
                  <p className="text-xs text-text-muted">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button size="sm" variant="primary" loading={saving} onClick={finish}>开始使用</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
