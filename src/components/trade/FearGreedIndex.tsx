"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";

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

function getColor(value: number): string {
  if (value <= 25) return "#ef4444";
  if (value <= 45) return "#f97316";
  if (value <= 55) return "#eab308";
  if (value <= 75) return "#84cc16";
  return "#22c55e";
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
        stroke="#2a2a2a"
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
      <circle cx={px} cy={py} r="3" fill="white" />
      {/* Pointer line from center */}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke="white" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r="2.5" fill="white" />
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
        <span className="text-sm">&#x1F9D0;</span>
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
      "border-border-default bg-bg-secondary/80 backdrop-blur-sm"
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
        <span className="text-text-muted">🧐</span>
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
