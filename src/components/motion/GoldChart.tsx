"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatPrice } from "@/lib/utils";
import type { BingXKline } from "@/types/bingx";

/**
 * 首屏的视觉主体：真实行情渲染成一条香槟金曲线。
 *
 * 这是产品本身在说话——不用假截图、不用插画。数据来自站内 klines 接口，
 * 一分钟刷新一次（营销面不需要交易终端那种 10 秒节奏）。
 *
 * 三层构成：
 *   1. 发丝刻度线 + 右侧等宽价格标签（高 / 低）
 *   2. 金色面积渐变（18% → 0）
 *   3. 1.25px 金线，挂载时用 stroke-dashoffset 从左向右画出来（2.4s）
 * 末端一枚呼吸的金点标出「现在」——它传达的是实时性，不是装饰。
 * prefers-reduced-motion 下曲线直接完整显示。
 */
interface GoldChartProps {
  symbol?: string;
  interval?: string;
  limit?: number;
  className?: string;
  /** 是否显示品种标签与价格标签 */
  labels?: boolean;
  /** 曲线相对高度（SVG viewBox 高度），默认 320 */
  height?: number;
}

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<BingXKline[]> {
  const url = new URL("/api/bingx/market/klines", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data as BingXKline[];
}

/** Catmull-Rom → 三次贝塞尔：让折线读成一条有张力的曲线。警报卡的 AlertSpark 复用同一条算法。 */
export function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const W = 1000;

export function GoldChart({
  symbol = "BTC-USDT",
  interval = "1h",
  limit = 168,
  className,
  labels = true,
  height = 320,
}: GoldChartProps) {
  const gradId = useId();
  const { data, isError } = useQuery({
    queryKey: ["gold-chart", symbol, interval, limit],
    queryFn: () => fetchKlines(symbol, interval, limit),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const [drawn, setDrawn] = useState(false);
  const drawnRef = useRef(false);
  useEffect(() => {
    if (!data?.length || drawnRef.current) return;
    drawnRef.current = true;
    // 下一帧再把 dashoffset 归零，确保初始态先落到 DOM 上
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const geom = useMemo(() => {
    if (!data?.length) return null;
    const closes = data
      .map((k) => Number(k.close))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const padTop = 28;
    const padBottom = 20;
    const usable = height - padTop - padBottom;
    const pts: [number, number][] = closes.map((v, i) => [
      (i / (closes.length - 1)) * W,
      padTop + (1 - (v - min) / range) * usable,
    ]);
    const line = smoothPath(pts);
    const last = pts[pts.length - 1];
    const area = `${line} L ${W} ${height} L 0 ${height} Z`;
    const first = closes[0];
    const lastClose = closes[closes.length - 1];
    const pct = ((lastClose - first) / first) * 100;
    return { pts, line, area, last, min, max, lastClose, pct, padTop, padBottom };
  }, [data, height]);

  const base = symbol.split("-")[0];
  const quote = symbol.split("-")[1] ?? "USDT";

  return (
    <div className={cn("relative h-full w-full", className)}>
      {labels && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 flex items-baseline gap-3">
          <span className="font-display text-sm font-medium tracking-tight text-text-primary">
            {base}
            <span className="text-text-muted"> / {quote}</span>
          </span>
          <span className="eyebrow">{interval}</span>
        </div>
      )}

      {labels && geom && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 text-right">
          <div className="font-mono text-lg tabular-nums leading-none text-text-primary sm:text-xl">
            {formatPrice(geom.lastClose)}
          </div>
          <div
            className={cn(
              "mt-1.5 font-mono text-[11px] tabular-nums",
              geom.pct >= 0 ? "text-success" : "text-danger"
            )}
          >
            {geom.pct >= 0 ? "+" : ""}
            {geom.pct.toFixed(2)}%
          </div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={`${gradId}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D3B26A" stopOpacity="0.22" />
            <stop offset="60%" stopColor="#D3B26A" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#D3B26A" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradId}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#A6863F" />
            <stop offset="55%" stopColor="#D3B26A" />
            <stop offset="100%" stopColor="#FBF3DC" />
          </linearGradient>
        </defs>

        {/* 发丝刻度：四条水平线，营销面的空间刻度 */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={height * f}
            y2={height * f}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {geom ? (
          <>
            <path
              d={geom.area}
              fill={`url(#${gradId}-area)`}
              className={cn("transition-opacity duration-[1600ms] ease-out", drawn ? "opacity-100" : "opacity-0")}
            />
            <path
              d={geom.line}
              fill="none"
              stroke={`url(#${gradId}-line)`}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset={drawn ? 0 : 1}
              className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-[2400ms] motion-safe:ease-out motion-reduce:[stroke-dashoffset:0]"
            />
          </>
        ) : (
          !isError && (
            <line
              x1="0"
              x2={W}
              y1={height / 2}
              y2={height / 2}
              stroke="rgba(211,178,106,0.25)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 8"
            />
          )
        )}
      </svg>

      {/* 末端金点：标出「现在」。用 HTML 定位而非 SVG，避免 preserveAspectRatio 拉伸成椭圆 */}
      {geom && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-full bg-gold-light transition-opacity duration-700",
            drawn ? "opacity-100 delay-[2200ms]" : "opacity-0"
          )}
          style={{
            left: `${(geom.last[0] / W) * 100}%`,
            top: `${(geom.last[1] / height) * 100}%`,
            boxShadow: "0 0 0 4px rgba(211,178,106,0.18)",
          }}
        />
      )}

      {/* 高低区间放在左下角的基线上：右上角已经被现价与涨跌占着，
          把它们也塞到右侧会叠在一起（早前的写法就是这样）。 */}
      {labels && geom && (
        <div className="pointer-events-none absolute bottom-0 left-0 flex items-center gap-4 font-mono text-[10px] tabular-nums text-text-faint">
          <span>H {formatPrice(geom.max)}</span>
          <span>L {formatPrice(geom.min)}</span>
        </div>
      )}
    </div>
  );
}
