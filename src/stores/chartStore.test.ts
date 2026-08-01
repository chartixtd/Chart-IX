import { describe, it, expect, beforeEach } from "vitest";
import { useChartStore, DEFAULT_DRAWING_LINE_WIDTH, DEFAULT_DRAWING_LINE_STYLE, DEFAULT_DRAWING_OPACITY, DRAWING_TOOLS } from "./chartStore";

beforeEach(() => {
  useChartStore.setState({ drawings: {}, appliedIndicators: [] });
});

describe("addDrawing style defaults", () => {
  it("fills lineWidth/lineStyle/opacity defaults when the caller only passes tool/points/color", () => {
    useChartStore.getState().addDrawing("BTC-USDT", {
      tool: "trendline",
      points: [{ time: 1, price: 100 }, { time: 2, price: 110 }],
      color: "#c9a24b",
    });
    const d = useChartStore.getState().drawings["BTC-USDT"][0];
    expect(d.lineWidth).toBe(DEFAULT_DRAWING_LINE_WIDTH);
    expect(d.lineStyle).toBe(DEFAULT_DRAWING_LINE_STYLE);
    expect(d.opacity).toBe(DEFAULT_DRAWING_OPACITY);
  });

  it("lets the caller override a style field", () => {
    useChartStore.getState().addDrawing("BTC-USDT", {
      tool: "rect",
      points: [{ time: 1, price: 100 }, { time: 2, price: 110 }],
      color: "#c9a24b",
      lineWidth: 4,
    });
    expect(useChartStore.getState().drawings["BTC-USDT"][0].lineWidth).toBe(4);
  });
});

describe("DRAWING_TOOLS", () => {
  it("has exactly one entry per DrawingTool, 15 total after the new tools", () => {
    expect(DRAWING_TOOLS.length).toBe(15);
    expect(new Set(DRAWING_TOOLS.map((t) => t.tool)).size).toBe(15);
  });
});
