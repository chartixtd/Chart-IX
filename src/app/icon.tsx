import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090B",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: -0.5,
            fontFamily: "system-ui, sans-serif",
            color: "#D3B26A",
          }}
        >
          IX
        </div>
      </div>
    ),
    { ...size }
  );
}
