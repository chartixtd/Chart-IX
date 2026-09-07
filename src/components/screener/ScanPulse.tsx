"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";
import { cn } from "@/lib/utils";

/**
 * 扫描周期表盘：抬头区右侧那一枚仪表。
 *
 * 它取代了原来那行 12px 的「下次扫描 12:34」。同一份数据（服务端 computedAt
 * + 15 分钟周期），换成三层可读的形态：
 *   1. 十五道分钟刻度——扫描周期正好 15 分钟，一道刻度就是一分钟，刻度是
 *      真实的尺，不是装饰
 *   2. 一条金色弧线从上方十二点位置顺时针长出来，长度 = 本轮已经过去的比例
 *   3. 弧线末端一枚金点标出「现在」，与首页 GoldChart 曲线末端那枚是同一个手势
 * 中央是倒计时，等宽字体，每秒更新。
 *
 * 每秒 setNow 的 state 关在这个组件里，不放在 layout 上——否则每秒一次
 * 的重渲染会把 ScannerTable 外面的 memo 打废。
 *
 * lastUpdated <= 0（还没成功拉到过数据）时表盘空着、中央显示 --:--；
 * 报错时由调用方传 disabled，刷新按钮跟着禁用。周期走满而 cron 没来
 * （缓存过期仍在服务）时弧线停在整圈、倒计时停在 00:00——那是真实状态，
 * 页面另有 computedAt 标出数据有多旧，不必藏。
 */
const R = 92;
const CIRC = 2 * Math.PI * R;
/** 15 分钟一轮，一道刻度一分钟 */
const TICKS = SCAN_INTERVAL_MS / 60_000;

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function ScanPulse({
  lastUpdated,
  isRefreshing,
  disabled = false,
  onRefresh,
  className,
}: {
  lastUpdated: number;
  isRefreshing: boolean;
  disabled?: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const t = useTranslations("screener");
  const gradId = useId();
  const [now, setNow] = useState(() => Date.now());
  // 挂载后下一帧才把弧线放到真实进度上，让它从零画出来（1.4s）。
  // 这不是装饰：它在说「这一轮已经走了这么久」。reduced-motion 下 globals.css
  // 会把过渡时长压到 0，弧线直接落到位。
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const known = lastUpdated > 0;
  const elapsed = known ? Math.min(Math.max(now - lastUpdated, 0), SCAN_INTERVAL_MS) : 0;
  const progress = armed ? elapsed / SCAN_INTERVAL_MS : 0;
  const remaining = known ? Math.max(0, lastUpdated + SCAN_INTERVAL_MS - now) : 0;

  // 「现在」那枚金点的位置：十二点起顺时针。用 HTML 定位而不是画在 SVG 里，
  // 与 GoldChart 同一个理由——SVG 被拉伸时圆点会变成椭圆。
  const angle = -Math.PI / 2 + progress * 2 * Math.PI;
  const dotX = 100 + R * Math.cos(angle);
  const dotY = 100 + R * Math.sin(angle);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative aspect-square w-[clamp(7rem,14vw,10rem)]">
        <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={`${gradId}-arc`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#A6863F" />
              <stop offset="55%" stopColor="#D3B26A" />
              <stop offset="100%" stopColor="#FBF3DC" />
            </linearGradient>
          </defs>

          {/* 分钟刻度：十五道，落在弧线外侧 */}
          {Array.from({ length: TICKS }).map((_, i) => {
            const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            return (
              <line
                key={i}
                x1={100 + (R + 6) * cos}
                y1={100 + (R + 6) * sin}
                x2={100 + (R + 10) * cos}
                y2={100 + (R + 10) * sin}
                stroke="rgba(244,241,234,0.16)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* 轨道 */}
          <circle cx="100" cy="100" r={R} fill="none" stroke="#1F1F24" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* 已过去的弧 */}
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={`url(#${gradId}-arc)`}
            strokeWidth="1.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            transform="rotate(-90 100 100)"
            className="transition-[stroke-dashoffset] duration-[1400ms] ease-out"
          />
        </svg>

        {known && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -ml-1 -mt-1 h-2 w-2 rounded-full bg-gold-light transition-opacity duration-700",
              armed ? "opacity-100 delay-[1200ms]" : "opacity-0"
            )}
            style={{
              left: `${(dotX / 200) * 100}%`,
              top: `${(dotY / 200) * 100}%`,
              boxShadow: "0 0 0 4px rgba(211,178,106,0.18)",
            }}
          />
        )}

        {/* px-6 + 居中：ms-MY 的「Imbasan seterusnya」在手机尺寸的表盘里要折成两行，
            不居中的话第二行会贴着弧线 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="font-mono text-[clamp(1.25rem,2.6vw,1.75rem)] tabular-nums leading-none text-text-primary">
            {known ? mmss(remaining) : "--:--"}
          </span>
          <span className="eyebrow mt-2 text-[10px] leading-snug">{t("next_scan")}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled || isRefreshing}
        className="link-underline mt-4 inline-flex min-h-[44px] items-center text-[11px] font-medium uppercase tracking-[0.14em] text-gold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0"
      >
        {t("refresh_now")}
      </button>
    </div>
  );
}
