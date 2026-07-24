import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

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
  const pnlColor = isProfit ? "#22c55e" : "#ef4444";

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
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "radial-gradient(circle at 50% 30%, rgba(212,168,67,0.14) 0%, rgba(10,10,10,0) 60%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 44, fontWeight: 700 }}>
          <span style={{ color: "#d4a843" }}>Chart</span>
          <span style={{ color: "#ffffff" }}>-IX</span>
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 22, color: "#a0a0a0" }}>
          模拟盘战绩 · Paper Trading
        </div>

        <div style={{ display: "flex", marginTop: 48, fontSize: 26, color: "#a0a0a0" }}>
          总资产 Total Value
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 64, fontWeight: 700, color: "#ffffff" }}>
          {fmt(totalValue)} <span style={{ fontSize: 28, marginLeft: 8, color: "#666666" }}>USDT</span>
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
              gap: 8,
              borderRadius: 999,
              border: "1px solid rgba(212,168,67,0.4)",
              backgroundColor: "rgba(212,168,67,0.1)",
              padding: "10px 24px",
              fontSize: 20,
              color: "#d4a843",
            }}
          >
            🏆 已获得 {achievements} 个成就
          </div>
        )}

        <div style={{ display: "flex", marginTop: 56, fontSize: 16, color: "#666666" }}>
          零风险模拟交易 · chart-ix.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
