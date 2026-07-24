import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "radial-gradient(circle at 50% 35%, rgba(212,168,67,0.16) 0%, rgba(10,10,10,0) 60%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 128,
            fontWeight: 700,
            letterSpacing: -2,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span style={{ color: "#d4a843" }}>Chart</span>
          <span style={{ color: "#ffffff" }}>-IX</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 34,
            color: "#a0a0a0",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Crypto Trading Education &amp; Live Trading
        </div>
      </div>
    ),
    { ...size }
  );
}
