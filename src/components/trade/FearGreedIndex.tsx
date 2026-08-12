"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { sentimentColor } from "@/lib/chart-theme";

interface FearGreedResponse {
  data: {
    value: string;
    value_classification: string;
    timestamp: string;
  }[];
}

async function fetchFearGreed(): Promise<FearGreedResponse> {
  const res = await fetch("https://api.alternative.me/fng/?limit=1");
  if (!res.ok) throw new Error("Failed to fetch fear & greed index");
  return res.json();
}

// 色带定义在 @/lib/chart-theme——原来那条是 Tailwind 默认色，冷绿冷黄在暖底上发脏
const getColor = sentimentColor;

/** 情绪表盘图标。这里原本用的是一个 emoji 字符——emoji 跨平台字形不一致、
 *  无法用设计 token 控制颜色与尺寸，站内一律不作结构性图标使用。 */
function SentimentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3.5 15a8.5 8.5 0 0 1 17 0" />
      <path d="m12 15 4.5-5" />
      <circle cx="12" cy="15" r="1.3" />
    </svg>
  );
}

/** SVG semi-circle gauge */
function Gauge({ value, size = 80 }: { value: number; size?: number }) {
  const strokeWidth = 8;
  const radius = (size / 2) - strokeWidth;
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  // Calculate pointer position on the arc (from pi to 2pi)
  const angle = Math.PI + (value / 100) * Math.PI;
  const pointerLength = radius - 6;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const px = cx + pointerLength * Math.cos(angle);
  const py = cy + pointerLength * Math.sin(angle);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* Background arc */}
      <path
        d={`M ${strokeWidth} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth} ${cy}`}
        fill="none"
        stroke="#2C271C"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        transform={`rotate(180, ${cx}, ${cy})`}
      />
      {/* Value arc */}
      <path
        d={`M ${strokeWidth} ${cy} A ${radius} ${radius} 0 0 1 ${size - strokeWidth} ${cy}`}
        fill="none"
        stroke={getColor(value)}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        transform={`rotate(180, ${cx}, ${cy})`}
        className="transition-all duration-700 ease-out"
      />
      {/* Pointer dot */}
      <circle cx={px} cy={py} r="3" fill="#F5F0E6" />
      {/* Pointer line from center */}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke="#F5F0E6" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="2.5" fill="#F5F0E6" />
    </svg>
  );
}

interface FearGreedIndexProps {
  compact?: boolean;
}

export function FearGreedIndex({ compact = false }: FearGreedIndexProps) {
  const [expanded, setExpanded] = useState(!compact);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["fear-greed"],
    queryFn: fetchFearGreed,
    staleTime: 3600000, // 1 hour - API updates once daily
    refetchInterval: 3600000,
  });

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-xs px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        title="Fear & Greed Index"
      >
        <SentimentIcon className="h-4 w-4" />
        {isLoading ? (
          <span className="h-3 w-8 animate-pulse rounded bg-bg-tertiary" />
        ) : isError ? (
          <span className="text-text-muted">--</span>
        ) : (
          <span
            className="font-mono font-semibold"
            style={{ color: getColor(parseInt(data?.data[0]?.value ?? "0")) }}
          >
            {data?.data[0]?.value ?? "--"}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={cn(
      "flex shrink-0 items-center gap-2 rounded-xs border px-2.5 py-1.5 text-xs",
      "border-border-default bg-bg-secondary"
    )}>
      {compact ? (
        <button
          onClick={() => setExpanded(false)}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="Minimize"
        >
          ×
        </button>
      ) : (
        <SentimentIcon className="h-4 w-4 text-text-muted" />
      )}

      {isLoading ? (
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 animate-pulse rounded-full bg-bg-tertiary" />
          <div className="space-y-1">
            <div className="h-3 w-16 animate-pulse rounded bg-bg-tertiary" />
            <div className="h-2 w-12 animate-pulse rounded bg-bg-tertiary" />
          </div>
        </div>
      ) : isError ? (
        <span className="text-text-muted">Unavailable</span>
      ) : (() => {
        const value = parseInt(data?.data[0]?.value ?? "0");
        const classification = data?.data[0]?.value_classification ?? "Unknown";
        const color = getColor(value);

        return (
          <>
            <Gauge value={value} size={compact ? 40 : 48} />
            <div className="flex flex-col">
              <span className="font-mono text-sm font-bold" style={{ color }}>
                {value}
              </span>
              <span
                className="text-[10px] font-medium leading-tight"
                style={{ color }}
              >
                {classification}
              </span>
            </div>
          </>
        );
      })()}
    </div>
  );
}
