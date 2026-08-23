import { describe, it, expect, beforeEach } from "vitest";
import { useChartStore, mergeChartState, DEFAULT_DRAWING_LINE_WIDTH, DEFAULT_DRAWING_LINE_STYLE, DEFAULT_DRAWING_OPACITY, DRAWING_TOOLS } from "./chartStore";

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

describe("mergeChartState (persist migration)", () => {
  it("backfills lineWidth/lineStyle/opacity on drawings persisted before those fields existed", () => {
    const current = useChartStore.getState();
    const persisted = {
      appliedIndicators: [],
      drawings: {
        "BTC-USDT": [
          {
            id: "legacy-1",
            tool: "rect",
            points: [{ time: 1, price: 100 }, { time: 2, price: 110 }],
            color: "#c9a24b",
            // lineWidth/lineStyle/opacity intentionally missing, as in a pre-feature save.
          },
        ],
      },
    };
    const merged = mergeChartState(persisted, current);
    const d = merged.drawings["BTC-USDT"][0];
    expect(d.lineWidth).toBe(DEFAULT_DRAWING_LINE_WIDTH);
    expect(d.lineStyle).toBe(DEFAULT_DRAWING_LINE_STYLE);
    expect(d.opacity).toBe(DEFAULT_DRAWING_OPACITY);
  });

  it("preserves an explicitly-set style field instead of overwriting it with the default", () => {
    const current = useChartStore.getState();
    const persisted = {
      drawings: {
        "BTC-USDT": [
          {
            id: "styled-1",
            tool: "rect",
            points: [{ time: 1, price: 100 }, { time: 2, price: 110 }],
            color: "#c9a24b",
            lineWidth: 4,
            lineStyle: "dashed",
            opacity: 0.5,
          },
        ],
      },
    };
    const merged = mergeChartState(persisted, current);
    const d = merged.drawings["BTC-USDT"][0];
    expect(d.lineWidth).toBe(4);
    expect(d.lineStyle).toBe("dashed");
    expect(d.opacity).toBe(0.5);
  });
});

describe("DRAWING_TOOLS", () => {
  it("has exactly one entry per DrawingTool, 15 total after the new tools", () => {
    expect(DRAWING_TOOLS.length).toBe(15);
    expect(new Set(DRAWING_TOOLS.map((t) => t.tool)).size).toBe(15);
  });
});

describe("indicator settings (CoinGlass inputs)", () => {
  beforeEach(() => useChartStore.setState({ appliedIndicators: [] }));

  it("addIndicator seeds settings from the definition's defaults, and leaves them off for plain indicators", () => {
    useChartStore.getState().addIndicator("cg_cvd");
    useChartStore.getState().addIndicator("ma");
    const [cvd, ma] = useChartStore.getState().appliedIndicators;
    expect(cvd.settings).toMatchObject({ symbolMode: "main", market: "futures", unit: "usd", exchangeMode: "all", display: "candles" });
    expect(ma.settings).toBeUndefined();
  });

  it("updateIndicatorSettings patches one instance only", () => {
    useChartStore.getState().addIndicator("cg_cvd");
    useChartStore.getState().addIndicator("cg_cvd");
    const [a, b] = useChartStore.getState().appliedIndicators;
    useChartStore.getState().updateIndicatorSettings(a.instanceId, { market: "spot", exchanges: ["OKX"] });
    const [a2, b2] = useChartStore.getState().appliedIndicators;
    expect(a2.settings?.market).toBe("spot");
    expect(a2.settings?.exchanges).toEqual(["OKX"]);
    expect(a2.settings?.unit).toBe("usd"); // untouched keys survive
    expect(b2.settings?.market).toBe("futures");
    expect(b2.instanceId).toBe(b.instanceId);
  });

  it("resetIndicatorToDefaults restores settings alongside params and styles", () => {
    useChartStore.getState().addIndicator("cg_oi");
    const id = useChartStore.getState().appliedIndicators[0].instanceId;
    useChartStore.getState().updateIndicatorSettings(id, { margin: "all", unit: "coin" });
    useChartStore.getState().updateIndicatorStyle(id, "oi", { upColor: "#123456" });
    useChartStore.getState().resetIndicatorToDefaults(id);
    const a = useChartStore.getState().appliedIndicators[0];
    expect(a.settings).toMatchObject({ margin: "coin", unit: "usd" });
    expect(a.styleOverrides).toBeUndefined();
  });

  it("mergeChartState backfills settings on instances persisted before they existed", () => {
    const merged = mergeChartState(
      { appliedIndicators: [{ instanceId: "old", defId: "cg_oi", params: {}, visible: true }] },
      useChartStore.getState()
    );
    expect(merged.appliedIndicators[0].settings).toMatchObject({ margin: "coin", display: "candles" });
    // and keeps user values when a subset was already stored
    const partial = mergeChartState(
      { appliedIndicators: [{ instanceId: "old", defId: "cg_oi", params: {}, visible: true, settings: { unit: "coin" } }] },
      useChartStore.getState()
    );
    expect(partial.appliedIndicators[0].settings).toMatchObject({ unit: "coin", margin: "coin" });
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
