import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 90,
            fontWeight: 700,
            letterSpacing: -3,
            fontFamily: "system-ui, sans-serif",
            color: "#d4a843",
          }}
        >
          IX
        </div>
      </div>
    ),
    { ...size }
  );
}
