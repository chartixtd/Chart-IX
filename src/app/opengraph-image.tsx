import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 分享卡是站外唯一能看到的品牌面，用的必须是站内同一套色板。
 * 这里原本是 #0a0a0a / #d4a843 / #a0a0a0 —— 一套没人维护的旧值。
 * Satori 不认 Tailwind，只能写字面量，改色板时记得同步。
 */
const INK = "#09090B";
const GOLD = "#D3B26A";
const GOLD_LIGHT = "#EEDCA6";
const TEXT = "#F4F1EA";
const MUTED = "#A7A39A";

export default function OpengraphImage() {
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
          // 环境光晕：站内 .aura 的静态等价物
          backgroundImage: `radial-gradient(circle at 50% 30%, rgba(211,178,106,0.14) 0%, rgba(9,9,11,0) 62%)`,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 128,
            fontWeight: 300,
            letterSpacing: -5,
          }}
        >
          <span style={{ color: TEXT }}>Chart</span>
          <span style={{ color: GOLD }}>-IX</span>
        </div>

        {/* 发丝金分隔线 */}
        <div
          style={{
            display: "flex",
            width: 220,
            height: 1,
            marginTop: 36,
            backgroundImage: `linear-gradient(90deg, rgba(211,178,106,0), ${GOLD_LIGHT}, rgba(211,178,106,0))`,
          }}
        />

        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 34,
            color: MUTED,
          }}
        >
          Crypto Trading Education &amp; Live Trading
        </div>
      </div>
    ),
    { ...size }
  );
}
