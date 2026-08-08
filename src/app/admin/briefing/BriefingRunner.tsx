"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export interface BriefingPageData {
  env: {
    deepseekKey: boolean;
    authorId: boolean;
    alertChatId: boolean;
    model: string;
    fallbackModel: string;
  };
  window: { hourNow: number; start: number; end: number; inWindow: boolean };
  heartbeat: { lastRunAt: string; lastStatus: string } | null;
  todaySlug: string;
  todayPublished: boolean;
  pushEnabled: boolean;
  recent: {
    slug: string;
    titleZh: string | null;
    titleEn: string | null;
    isPublished: boolean;
    publishedAt: string | null;
    createdAt: string;
  }[];
}

interface RunResult {
  success: boolean;
  status?: "published" | "fallback" | "skipped" | "failed";
  slug?: string;
  detail?: string;
  error?: string;
}

const LOCALES = ["zh-CN", "en-US", "ms-MY"] as const;

/** 五种运行结果各自代表什么——出问题时这段说明比状态码本身有用 */
const STATUS_COPY: Record<string, { label: string; tone: string; hint: string }> = {
  published: {
    label: "已发布",
    tone: "text-success",
    hint: "AI 生成并通过了质量门槛。请逐个语言打开检查，尤其是 ms-MY——它回退显示英文版，是最容易暴露翻译问题的一个。",
  },
  fallback: {
    label: "已发布（兜底稿）",
    tone: "text-gold",
    hint: "AI 那条路没走通，发的是零 AI 兜底稿：只有真实新闻标题和真实行情，没有任何 AI 判断。文章本身可用，但值得去 Sentry 看看降级原因。",
  },
  skipped: {
    label: "已跳过",
    tone: "text-text-secondary",
    hint: "今天已经出过稿了。幂等闸门靠 articles.slug 的唯一约束，同一天不会出第二篇。要重新生成得先删掉今天那篇。",
  },
  failed: {
    label: "失败",
    tone: "text-danger",
    hint: "没有落库。最常见的原因是环境变量缺失或数据不足，具体看下面的 detail 与 Sentry。",
  },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch {
    return iso;
  }
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-success" : "text-danger"}>{ok ? "✓" : "✗"}</span>
      <span className={ok ? "text-text-primary" : "text-danger"}>{children}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-border-default glass p-4">
      <h2 className="mb-3 text-sm font-medium text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

export function BriefingRunner({ data }: { data: BriefingPageData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const envReady = data.env.deepseekKey && data.env.authorId;

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/briefing/run-now", { method: "POST" });
      const body = (await res.json()) as RunResult;
      setResult(body);
      toast(
        body.status ? STATUS_COPY[body.status]?.label ?? body.status : "请求失败",
        body.success ? "success" : "error"
      );
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络错误";
      setResult({ success: false, error: message });
      toast(message, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="环境就绪">
        <div className="space-y-1.5">
          <Check ok={data.env.deepseekKey}>
            DEEPSEEK_API_KEY {data.env.deepseekKey ? "已配置" : "未配置 —— 流水线会直接失败"}
          </Check>
          <Check ok={data.env.authorId}>
            BRIEFING_AUTHOR_ID {data.env.authorId ? "已配置" : "未配置 —— 流水线会直接失败"}
          </Check>
          <Check ok={data.env.alertChatId}>
            BRIEFING_ALERT_CHAT_ID{" "}
            {data.env.alertChatId ? "已配置" : "未配置 —— 降级只记 Sentry，不发 Telegram（可选）"}
          </Check>
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          模型：{data.env.model} → 失败回退 {data.env.fallbackModel}
          {" · "}推送：{data.pushEnabled ? "已开启" : "已关闭"}（在站点设置里改 daily_briefing_push_enabled）
        </p>
        {!envReady && (
          <p className="mt-2 text-xs text-danger">
            改完 Vercel 环境变量必须重新部署一次，否则不会生效。
          </p>
        )}
      </Card>

      <Card title="发布窗口与心跳">
        <div className="space-y-1.5 text-sm text-text-primary">
          <div>
            当前 UTC+8 {String(data.window.hourNow).padStart(2, "0")} 点，窗口{" "}
            {data.window.start}:00–{data.window.end}:59（
            <span className={data.window.inWindow ? "text-success" : "text-text-secondary"}>
              {data.window.inWindow ? "在窗口内" : "不在窗口内"}
            </span>
            ）
          </div>
          <div>
            心跳：{data.heartbeat ? `${fmt(data.heartbeat.lastRunAt)} · ${data.heartbeat.lastStatus}` : "从未运行过"}
          </div>
          <div>
            今天（{data.todaySlug.replace("daily-briefing-", "")}）：
            <span className={data.todayPublished ? "text-success" : "text-text-secondary"}>
              {data.todayPublished ? "已出稿" : "尚未出稿"}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          窗口外 cron 会返回 skipped 而不出稿，这是设计如此。下面的按钮绕过窗口，可随时触发。
        </p>
      </Card>

      <Card title="立即生成">
        <button
          onClick={run}
          disabled={running || !envReady}
          className={cn(
            "rounded-sm px-4 py-2 text-sm font-medium transition-colors",
            running || !envReady
              ? "bg-bg-tertiary text-text-secondary cursor-not-allowed"
              : "bg-gold/10 text-gold hover:bg-gold/20"
          )}
        >
          {running ? "生成中…（最长约 50 秒）" : "立即生成早报"}
        </button>
        {!envReady && (
          <p className="mt-2 text-xs text-text-secondary">环境变量配齐并重新部署后才能触发。</p>
        )}

        {result && (
          <div className="mt-4 rounded-sm border border-border-default bg-bg-tertiary p-3">
            {result.status ? (
              <>
                <div className={cn("text-sm font-medium", STATUS_COPY[result.status]?.tone)}>
                  {STATUS_COPY[result.status]?.label ?? result.status}
                  {result.slug && <span className="ml-2 text-text-secondary">{result.slug}</span>}
                </div>
                <p className="mt-1.5 text-xs text-text-secondary">
                  {STATUS_COPY[result.status]?.hint}
                </p>
              </>
            ) : (
              <div className="text-sm text-danger">{result.error ?? "请求失败"}</div>
            )}
            {result.detail && (
              <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-text-secondary">
                {result.detail}
              </pre>
            )}
          </div>
        )}
      </Card>

      <Card title={`最近 ${data.recent.length} 篇`}>
        {data.recent.length === 0 ? (
          <p className="text-sm text-text-secondary">还没有任何早报。</p>
        ) : (
          <div className="space-y-3">
            {data.recent.map((a) => (
              <div
                key={a.slug}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-default pb-3 last:border-0 last:pb-0"
              >
                <span className={a.isPublished ? "text-success text-xs" : "text-gold text-xs"}>
                  {a.isPublished ? "已发布" : "草稿"}
                </span>
                <span className="text-sm text-text-primary">{a.titleZh ?? a.slug}</span>
                <span className="text-xs text-text-secondary">
                  {fmt(a.publishedAt ?? a.createdAt)}
                </span>
                <span className="ml-auto flex gap-2">
                  {LOCALES.map((loc) => (
                    <a
                      key={loc}
                      href={`/${loc}/articles/${a.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gold hover:underline"
                    >
                      {loc}
                    </a>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-text-secondary">
          验收时三个语言都要点开。ms-MY 没有独立正文，按回退链显示英文版——如果它显示的是中文，
          说明翻译通道出了问题。
        </p>
      </Card>
    </div>
  );
}
