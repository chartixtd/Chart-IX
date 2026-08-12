import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * 站内色板的字面量副本 —— Satori 不认 Tailwind class。
 * 这里原本是 #0a0a0a / #d4a843 / #a0a0a0 / Tailwind 默认红绿，跟站内对不上；
 * 分享卡是产品在站外唯一的门面，色板漂移在这里代价最大。改色板时同步这几个值。
 */
const INK = "#0B0A08";
const GOLD = "#C9A24B";
const GOLD_LIGHT = "#EBD08A";
const TEXT = "#F5F0E6";
const MUTED = "#8A8172";
const UP = "#34C77B";
const DOWN = "#E85055";

function fmt(n: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const totalValue = parseFloat(searchParams.get("totalValue") ?? "10000");
  const pnl = parseFloat(searchParams.get("pnl") ?? "0");
  const pnlPct = parseFloat(searchParams.get("pnlPct") ?? "0");
  const achievements = parseInt(searchParams.get("achievements") ?? "0", 10);

  const isProfit = pnl >= 0;
  const pnlColor = isProfit ? UP : DOWN;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: INK,
          backgroundImage:
            "radial-gradient(circle at 50% 30%, rgba(201,162,75,0.16) 0%, rgba(11,10,8,0) 62%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 44, fontWeight: 700 }}>
          <span style={{ color: TEXT }}>Chart</span>
          <span style={{ color: GOLD }}>-IX</span>
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 22, color: MUTED }}>
          模拟盘战绩 · Paper Trading
        </div>

        <div
          style={{
            display: "flex",
            width: 180,
            height: 1,
            marginTop: 28,
            backgroundImage: `linear-gradient(90deg, rgba(201,162,75,0), ${GOLD_LIGHT}, rgba(201,162,75,0))`,
          }}
        />

        <div style={{ display: "flex", marginTop: 36, fontSize: 26, color: MUTED }}>
          总资产 Total Value
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 64, fontWeight: 700, color: TEXT }}>
          {fmt(totalValue)} <span style={{ fontSize: 28, marginLeft: 8, color: MUTED }}>USDT</span>
        </div>

        <div style={{ display: "flex", marginTop: 24, fontSize: 40, fontWeight: 700, color: pnlColor }}>
          {isProfit ? "+" : ""}{fmt(pnl)} ({isProfit ? "+" : ""}{fmt(pnlPct)}%)
        </div>

        {achievements > 0 && (
          <div
            style={{
              display: "flex",
              marginTop: 40,
              alignItems: "center",
              gap: 10,
              borderRadius: 999,
              border: `1px solid rgba(201,162,75,0.4)`,
              backgroundColor: "rgba(201,162,75,0.1)",
              padding: "10px 24px",
              fontSize: 20,
              color: GOLD,
            }}
          >
            {/* 原来这里是一个奖杯 emoji：跨平台字形不一致，且在 Satori 里依赖系统
                emoji 字体，服务端渲染环境常常直接渲染成豆腐块。改画矢量。 */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
              <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
              <path d="M12 14v3M9 20h6M10 17h4" />
            </svg>
            已获得 {achievements} 个成就
          </div>
        )}

        <div style={{ display: "flex", marginTop: 56, fontSize: 16, color: MUTED }}>
          零风险模拟交易 · chart-ix.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
