import { describe, it, expect } from "vitest";
import { migrateLegacyIndicators, DEFAULT_APPLIED_INDICATORS } from "@/stores/chartStore";
import { INDICATOR_BY_ID } from "./indicator-registry";

const ids = (list: { defId: string }[]) => list.map((a) => a.defId);

describe("migrateLegacyIndicators", () => {
  it("falls back to defaults when there is nothing to migrate", () => {
    expect(migrateLegacyIndicators(undefined, undefined)).toBe(DEFAULT_APPLIED_INDICATORS);
  });

  it("turns the v1 MA pair into two independent instances carrying their periods", () => {
    const out = migrateLegacyIndicators(
      { showMA: true, bottomPane: "volume" },
      { maPeriod1: 7, maPeriod2: 25 }
    );
    const mas = out.filter((a) => a.defId === "ma");
    expect(mas).toHaveLength(2);
    expect(mas.map((m) => m.params.period).sort((a, b) => a - b)).toEqual([7, 25]);
  });

  it("carries multi-param indicators across intact", () => {
    const out = migrateLegacyIndicators(
      { showBB: true, showSuperTrend: true, bottomPane: "volume" },
      { bbPeriod: 34, bbMultiplier: 2.5, superTrendPeriod: 14, superTrendMultiplier: 4 }
    );
    const bb = out.find((a) => a.defId === "bb")!;
    expect(bb.params).toMatchObject({ period: 34, multiplier: 2.5 });
    const st = out.find((a) => a.defId === "supertrend")!;
    expect(st.params).toMatchObject({ period: 14, multiplier: 4 });
  });

  it("maps the single v1 bottom pane to the matching pane indicator", () => {
    const rsi = migrateLegacyIndicators({ bottomPane: "rsi" }, { rsiPeriod: 21 });
    expect(ids(rsi)).toContain("rsi");
    expect(rsi.find((a) => a.defId === "rsi")!.params.period).toBe(21);

    const macd = migrateLegacyIndicators(
      { bottomPane: "macd" },
      { macdFast: 8, macdSlow: 21, macdSignal: 5 }
    );
    expect(macd.find((a) => a.defId === "macd")!.params).toMatchObject({
      fast: 8, slow: 21, signal: 5,
    });
  });

  it("defaults to volume when the saved bottom pane is unknown", () => {
    expect(ids(migrateLegacyIndicators({ bottomPane: "nope" }, {}))).toContain("volume");
  });

  it("fills params the legacy save never had with registry defaults", () => {
    // v1 stored no Ichimoku periods for users who never opened that section.
    const out = migrateLegacyIndicators({ showIchimoku: true, bottomPane: "volume" }, {});
    const ich = out.find((a) => a.defId === "ichimoku")!;
    const def = INDICATOR_BY_ID.get("ichimoku")!;
    for (const p of def.params) {
      expect(Number.isFinite(ich.params[p.key]), `${p.key} unset`).toBe(true);
    }
  });

  it("ignores non-finite legacy params instead of poisoning the instance", () => {
    const out = migrateLegacyIndicators(
      { showMA: true, bottomPane: "volume" },
      { maPeriod1: NaN as unknown as number, maPeriod2: 50 }
    );
    for (const a of out.filter((x) => x.defId === "ma")) {
      expect(Number.isFinite(a.params.period)).toBe(true);
    }
  });

  it("only produces instances that exist in the registry, each with a unique id", () => {
    const out = migrateLegacyIndicators(
      {
        showMA: true, showEMA: true, showBB: true, showVWAP: true, showSAR: true,
        showVWMA: true, showKC: true, showDonchian: true, showSuperTrend: true,
        showDEMA: true, showTEMA: true, showEnvelope: true, showIchimoku: true,
        bottomPane: "stoch",
      },
      {}
    );
    for (const a of out) expect(INDICATOR_BY_ID.has(a.defId), `${a.defId} unknown`).toBe(true);
    const instanceIds = out.map((a) => a.instanceId);
    expect(new Set(instanceIds).size).toBe(instanceIds.length);
    expect(out.every((a) => a.visible)).toBe(true);
    // 13 overlays (MA and EMA contribute two each) + the stochastic pane
    expect(out).toHaveLength(16);
  });
});
