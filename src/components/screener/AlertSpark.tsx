"use client";

import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { smoothPath } from "@/components/motion/GoldChart";
import type { BingXKline } from "@/types/bingx";
import type { InvalidationLine } from "@/lib/screener/invalidation";

/**
 * 警报卡上的 24 小时价格曲线：48 根 30 分钟永续 K 线，叠两条参考线。
 *
 * 它取代了原来那条「实时价 / 首次警报价 / 失效价」三格数字带。三个数字读者
 * 要在脑子里自己摆成一张图（现价离失效线还有多远？离首次价走了多少？），
 * 而这张图直接把它们摆好：一条曲线、一条首次价的虚线、一条失效价的红虚线。
 * 与首页 GoldChart 同一个手势——产品本身就是画面，不用假图。
 *
 * 纵轴范围**必须**把两条参考线也包进去：只按曲线取范围的话，一张离失效线
 * 还很远的卡会把失效线画到框外，读者反而看不到「离失效还有多远」这个最要紧
 * 的信息。
 *
 * 颜色走 currentColor：把场景基调色的 text-* 类挂在最外层，曲线、面积渐变、
 * 末端金点全部跟着走，不必为 SVG 再维护一份十六进制色表。已结束的卡传灰色。
 *
 * 取永续（market=futures）而不是现货：卡片的实时价来自永续推送，失效判定也
 * 用永续价，曲线要跟它们同源；而且带乘数的币（1000PEPE-USDT）现货根本没有。
 * 每两分钟刷一次——这条曲线看的是 24 小时形态，不需要交易终端那种节奏。
 */
const W = 1000;
const H = 64;
const PAD = 5;

async function fetchFuturesKlines(symbol: string): Promise<BingXKline[]> {
  const url = new URL("/api/bingx/market/klines", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "30m");
  url.searchParams.set("limit", "48");
  url.searchParams.set("market", "futures");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "API error");
  return json.data as BingXKline[];
}

export function AlertSpark({
  symbol,
  firstPrice,
  invalidation,
  toneClassName,
  className,
}: {
  symbol: string;
  firstPrice: number;
  invalidation: InvalidationLine | null;
  /** 场景基调色的 text-* 类；曲线与末端点都从它取 currentColor */
  toneClassName: string;
  className?: string;
}) {
  const gradId = useId();
  const { data, isError } = useQuery({
    queryKey: ["alert-spark", symbol],
    queryFn: () => fetchFuturesKlines(symbol),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const geom = useMemo(() => {
    if (!data?.length) return null;
    // 不假设接口的时间顺序：现货与永续两个端点在这一点上不一致过。
    const closes = [...data]
      .sort((a, b) => a.openTime - b.openTime)
      .map((k) => Number(k.close))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (closes.length < 2) return null;

    const levels = [firstPrice, invalidation?.price].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    const lo = Math.min(...closes, ...levels);
    const hi = Math.max(...closes, ...levels);
    const range = hi - lo || hi * 0.01 || 1;
    const y = (v: number) => PAD + (1 - (v - lo) / range) * (H - 2 * PAD);

    const pts: [number, number][] = closes.map((v, i) => [(i / (closes.length - 1)) * W, y(v)]);
    const line = smoothPath(pts);
    return {
      line,
      area: `${line} L ${W} ${H} L 0 ${H} Z`,
      last: pts[pts.length - 1],
      yFirst: y(firstPrice),
      yInvalid: invalidation ? y(invalidation.price) : null,
    };
  }, [data, firstPrice, invalidation]);

  return (
    <div className={cn("relative w-full", toneClassName, className)} aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={`${gradId}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geom ? (
          <>
            {/* 首次警报价：中性虚线 */}
            <line
              x1="0"
              x2={W}
              y1={geom.yFirst}
              y2={geom.yFirst}
              stroke="rgba(167,163,154,0.55)"
              strokeWidth="1"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            {/* 失效价：红虚线。它是这张图上唯一不跟场景色走的线 */}
            {geom.yInvalid !== null && (
              <line
                x1="0"
                x2={W}
                y1={geom.yInvalid}
                y2={geom.yInvalid}
                stroke="rgba(234,90,95,0.6)"
                strokeWidth="1"
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path d={geom.area} fill={`url(#${gradId}-area)`} className="animate-fade-in" />
            <path
              d={geom.line}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="animate-fade-in"
            />
          </>
        ) : (
          !isError && (
            <line
              x1="0"
              x2={W}
              y1={H / 2}
              y2={H / 2}
              stroke="rgba(244,241,234,0.12)"
              strokeWidth="1"
              strokeDasharray="4 8"
              vectorEffect="non-scaling-stroke"
            />
          )
        )}
      </svg>

      {/* 末端一点标出「现在」。HTML 定位而不是画在 SVG 里：preserveAspectRatio=none 会把圆拉成椭圆 */}
      {geom && (
        <span
          className="pointer-events-none absolute -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-current animate-fade-in"
          style={{ left: `${(geom.last[0] / W) * 100}%`, top: `${(geom.last[1] / H) * 100}%` }}
        />
      )}
    </div>
  );
}
