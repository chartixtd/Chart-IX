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

describe("updateIndicatorStyle", () => {
  it("sets a style override for one plot without touching other plots or params", () => {
    useChartStore.getState().addIndicator("bb"); // multi-plot indicator: upper/middle/lower
    const instanceId = useChartStore.getState().appliedIndicators[0].instanceId;
    useChartStore.getState().updateIndicatorStyle(instanceId, "upper", { color: "#ff0000" });
    const a = useChartStore.getState().appliedIndicators[0];
    expect(a.styleOverrides?.upper?.color).toBe("#ff0000");
    expect(a.styleOverrides?.middle).toBeUndefined();
  });

  it("resetIndicatorToDefaults also clears styleOverrides", () => {
    useChartStore.getState().addIndicator("ma");
    const instanceId = useChartStore.getState().appliedIndicators[0].instanceId;
    useChartStore.getState().updateIndicatorStyle(instanceId, "ma", { color: "#ff0000" });
    useChartStore.getState().resetIndicatorToDefaults(instanceId);
    expect(useChartStore.getState().appliedIndicators[0].styleOverrides).toBeUndefined();
  });
});
