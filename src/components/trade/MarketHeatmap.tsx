"use client";

import { useMemo, useState, useCallback } from "react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { useSpotTickers } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { useMarketStore } from "@/stores/market";
import { formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

const WS_SUBSCRIBE_LIMIT = 30;

interface HeatmapDataItem {
  name: string;
  size: number;
  changePercent: number;
  lastPrice: number;
}

export function MarketHeatmap() {
  const { data: tickers, isLoading } = useSpotTickers();
  const wsTickers = useMarketStore((s) => s.tickers);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const wsSymbols = useMemo(() => {
    if (!tickers) return [];
    return tickers.slice(0, WS_SUBSCRIBE_LIMIT).map((t) => t.symbol);
  }, [tickers]);

  useBingXWebSocket(wsSymbols);

  const data = useMemo(() => {
    if (!tickers) return [];
    return tickers
      .filter((t) => {
        const vol = parseFloat(t.volume);
        return !isNaN(vol) && vol > 0;
      })
      .map((t) => {
        const merged = wsTickers[t.symbol] ?? t;
        return {
          name: t.symbol,
          size: Math.sqrt(parseFloat(t.volume)),
          changePercent: parseFloat(merged.priceChangePercent),
          lastPrice: parseFloat(merged.lastPrice),
        };
      })
      .sort((a, b) => b.size - a.size)
      .slice(0, 80);
  }, [tickers, wsTickers]);

  const handleClick = useCallback((_data: unknown, index: number) => {
    const item = data[index];
    if (item) {
      setSelectedSymbol((prev) => (prev === item.name ? null : item.name));
    }
  }, [data]);

  const maxAbsChange = useMemo(() => {
    if (!data.length) return 0;
    return Math.max(...data.map((d) => Math.abs(d.changePercent)));
  }, [data]);

  const getColor = (changePercent: number) => {
    if (maxAbsChange === 0) return "#333";
    const ratio = Math.abs(changePercent) / maxAbsChange;
    const alpha = 0.25 + ratio * 0.55;
    if (changePercent >= 0) {
      return `rgba(34, 197, 94, ${alpha})`;
    }
    return `rgba(239, 68, 68, ${alpha})`;
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-text-muted">
        No data available
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Treemap
          data={data as any}
          dataKey="size"
          nameKey="name"
          stroke="#1a1a1a"
          animationDuration={300}
          isAnimationActive={true}
          content={(({ root, x, y, width, height, index, name }: any) => {
            if (!root) return null;
            if (!width || !height || width <= 0 || height <= 0) return null;
            const item = data[index ?? 0];
            if (!item) return null as any;

            const fill = getColor(item.changePercent);
            const fontSize = Math.max(9, Math.min(13, Math.sqrt(width * height) / 8));
            const showPercent = (width as number) > 45 && (height as number) > 30;

            return (
              <g
                onClick={() => handleClick(null, index ?? 0)}
                className="cursor-pointer"
              >
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={fill}
                  stroke={selectedSymbol === item.name ? "#fbbf24" : "#1a1a1a"}
                  strokeWidth={selectedSymbol === item.name ? 2 : 1}
                  rx={2}
                />
                {(width as number) > 35 && (height as number) > 18 && (
                  <text
                    x={(x as number) + (width as number) / 2}
                    y={(y as number) + (height as number) / 2 - (showPercent ? 6 : 0)}
                    textAnchor="middle"
                    fill="#e0e0e0"
                    fontSize={fontSize}
                    fontFamily="monospace"
                    fontWeight={500}
                  >
                    {(name as string)?.replace("-USDT", "") ?? ""}
                  </text>
                )}
                {showPercent && (
                  <text
                    x={(x as number) + (width as number) / 2}
                    y={(y as number) + (height as number) / 2 + 8}
                    textAnchor="middle"
                    fill={item.changePercent >= 0 ? "#22c55e" : "#ef4444"}
                    fontSize={Math.max(8, fontSize - 2)}
                    fontFamily="monospace"
                  >
                    {formatPercent(item.changePercent)}
                  </text>
                )}
              </g>
            );
          }) as any}
        >
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload || !payload[0]) return null;
              const item = payload[0].payload as HeatmapDataItem;
              return (
                <div className="rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium text-text-primary">{item.name}</div>
                  <div className="text-text-secondary">
                    Price: <span className="font-mono text-text-primary">{item.lastPrice.toFixed(2)}</span>
                  </div>
                  <div className={cn(item.changePercent >= 0 ? "text-success" : "text-danger")}>
                    {formatPercent(item.changePercent)}
                  </div>
                </div>
              );
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
