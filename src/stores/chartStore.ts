import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  INDICATOR_BY_ID, defaultParams, type IndicatorDef, type PlotStyleOverride,
} from "@/lib/chart/indicator-registry";

// ==================== Applied indicators ====================

/** One configured instance of a registry indicator. Multiple instances per defId are allowed. */
export interface AppliedIndicator {
  instanceId: string;
  defId: string;
  params: Record<string, number>;
  visible: boolean;
  styleOverrides?: Record<string, PlotStyleOverride>;
}

// ==================== Drawings ====================

export type DrawingTool =
  | "trendline" | "ray" | "hline" | "vline" | "rect" | "fib" | "text"
  | "channel" | "fib-extension" | "fib-fan"
  | "circle" | "triangle" | "arrow"
  | "price-range" | "date-range";

/** Anchored in chart space (time + price) so drawings survive pan, zoom, and interval changes. */
export interface DrawingPoint {
  /** Seconds since epoch, matching the chart's UTCTimestamp scale. */
  time: number;
  price: number;
}

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

export interface Drawing {
  id: string;
  tool: DrawingTool;
  points: DrawingPoint[];
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineStyle: DrawingLineStyle;
  /** Fill opacity (0-1) for shapes that have an interior: rect, channel, circle, triangle. */
  opacity: number;
  /** Only for the text tool. */
  fontSize?: number;
  /** Only for the text tool. */
  text?: string;
}

export const DRAWING_TOOLS: { tool: DrawingTool; label: string; points: number }[] = [
  { tool: "trendline", label: "趋势线", points: 2 },
  { tool: "ray", label: "射线", points: 2 },
  { tool: "hline", label: "水平线", points: 1 },
  { tool: "vline", label: "垂直线", points: 1 },
  { tool: "rect", label: "矩形", points: 2 },
  { tool: "fib", label: "斐波那契回撤", points: 2 },
  { tool: "text", label: "文字标注", points: 1 },
  { tool: "channel", label: "平行通道", points: 3 },
  { tool: "fib-extension", label: "斐波那契扩展", points: 2 },
  { tool: "fib-fan", label: "斐波那契扇形线", points: 2 },
  { tool: "circle", label: "圆形", points: 2 },
  { tool: "triangle", label: "三角形", points: 2 },
  { tool: "arrow", label: "箭头", points: 2 },
  { tool: "price-range", label: "价格范围", points: 2 },
  { tool: "date-range", label: "时间范围", points: 2 },
];

export const DRAWING_COLORS = ["#c9a24b", "#60a5fa", "#22c55e", "#ef4444", "#c084fc", "#f5f0e6"];

export const DEFAULT_DRAWING_LINE_WIDTH: Drawing["lineWidth"] = 2;
export const DEFAULT_DRAWING_LINE_STYLE: DrawingLineStyle = "solid";
export const DEFAULT_DRAWING_OPACITY = 0.08;
export const DEFAULT_DRAWING_FONT_SIZE = 12;

export const DEFAULT_APPLIED_INDICATORS: AppliedIndicator[] = [
  { instanceId: "seed-volume", defId: "volume", params: {}, visible: true },
];

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ==================== Legacy migration ====================

/** The pre-registry saved shape, kept only so v1 preferences can be migrated. */
interface LegacyChartIndicators {
  showMA?: boolean; showEMA?: boolean; showBB?: boolean; showVWAP?: boolean;
  showSAR?: boolean; showVWMA?: boolean; showKC?: boolean; showDonchian?: boolean;
  showSuperTrend?: boolean; showDEMA?: boolean; showTEMA?: boolean;
  showEnvelope?: boolean; showIchimoku?: boolean;
  bottomPane?: string;
}
type LegacyParams = Record<string, number>;

/**
 * Rebuild v1's boolean flags + flat params into indicator instances, so a user
 * who had MA/EMA/RSI configured keeps exactly that after the rebuild instead of
 * silently reverting to defaults.
 */
export function migrateLegacyIndicators(
  legacy: LegacyChartIndicators | undefined,
  lp: LegacyParams | undefined
): AppliedIndicator[] {
  if (!legacy) return DEFAULT_APPLIED_INDICATORS;
  const out: AppliedIndicator[] = [];
  const add = (defId: string, params: Record<string, number> = {}) => {
    const def = INDICATOR_BY_ID.get(defId);
    if (!def) return;
    // Fill any param the legacy shape didn't carry with the registry default.
    out.push({ instanceId: uid(), defId, params: { ...defaultParams(def), ...params }, visible: true });
  };
  const n = (v: number | undefined, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  if (legacy.showMA) {
    add("ma", { period: n(lp?.maPeriod1, 7) });
    add("ma", { period: n(lp?.maPeriod2, 25) });
  }
  if (legacy.showEMA) {
    add("ema", { period: n(lp?.emaPeriod1, 12) });
    add("ema", { period: n(lp?.emaPeriod2, 26) });
  }
  if (legacy.showBB) add("bb", { period: n(lp?.bbPeriod, 20), multiplier: n(lp?.bbMultiplier, 2) });
  if (legacy.showVWAP) add("vwap");
  if (legacy.showVWMA) add("vwma", { period: n(lp?.vwmaPeriod, 20) });
  if (legacy.showSAR) add("sar", { step: n(lp?.sarStep, 0.02), max: n(lp?.sarMax, 0.2) });
  if (legacy.showKC) {
    add("kc", {
      period: n(lp?.kcPeriod, 20), atrPeriod: n(lp?.kcAtrPeriod, 10),
      multiplier: n(lp?.kcMultiplier, 2),
    });
  }
  if (legacy.showDonchian) add("donchian", { period: n(lp?.donchianPeriod, 20) });
  if (legacy.showSuperTrend) {
    add("supertrend", {
      period: n(lp?.superTrendPeriod, 10), multiplier: n(lp?.superTrendMultiplier, 3),
    });
  }
  if (legacy.showDEMA) add("dema", { period: n(lp?.demaPeriod, 20) });
  if (legacy.showTEMA) add("tema", { period: n(lp?.temaPeriod, 20) });
  if (legacy.showEnvelope) {
    add("envelope", { period: n(lp?.envelopePeriod, 20), percent: n(lp?.envelopePercent, 2.5) });
  }
  if (legacy.showIchimoku) {
    add("ichimoku", {
      tenkan: n(lp?.ichimokuTenkan, 9), kijun: n(lp?.ichimokuKijun, 26),
      senkouB: n(lp?.ichimokuSenkouB, 52),
    });
  }

  // v1 allowed exactly one bottom pane; map it to the matching pane indicator.
  const paneMap: Record<string, { id: string; params?: Record<string, number> }> = {
    volume: { id: "volume" },
    rsi: { id: "rsi", params: { period: n(lp?.rsiPeriod, 14) } },
    macd: {
      id: "macd",
      params: { fast: n(lp?.macdFast, 12), slow: n(lp?.macdSlow, 26), signal: n(lp?.macdSignal, 9) },
    },
    stoch: { id: "stoch", params: { k: n(lp?.stochKPeriod, 14), d: n(lp?.stochDPeriod, 3) } },
    cci: { id: "cci", params: { period: n(lp?.cciPeriod, 20) } },
    willr: { id: "willr", params: { period: n(lp?.willrPeriod, 14) } },
    atr: { id: "atr", params: { period: n(lp?.atrPeriod, 14) } },
    adx: { id: "adx", params: { period: n(lp?.adxPeriod, 14) } },
    obv: { id: "obv" },
    momentum: { id: "momentum", params: { period: n(lp?.momentumPeriod, 10) } },
    roc: { id: "roc", params: { period: n(lp?.rocPeriod, 12) } },
    mfi: { id: "mfi", params: { period: n(lp?.mfiPeriod, 14) } },
    trix: { id: "trix", params: { period: n(lp?.trixPeriod, 15) } },
    cmf: { id: "cmf", params: { period: n(lp?.cmfPeriod, 20) } },
    aroon: { id: "aroon", params: { period: n(lp?.aroonPeriod, 25) } },
    uo: {
      id: "uo",
      params: { p1: n(lp?.uoPeriod1, 7), p2: n(lp?.uoPeriod2, 14), p3: n(lp?.uoPeriod3, 28) },
    },
    cmo: { id: "cmo", params: { period: n(lp?.cmoPeriod, 14) } },
    dpo: { id: "dpo", params: { period: n(lp?.dpoPeriod, 20) } },
    stddev: { id: "stddev", params: { period: n(lp?.stddevPeriod, 20) } },
  };
  const pane = paneMap[legacy.bottomPane ?? "volume"] ?? paneMap.volume;
  add(pane.id, pane.params);

  return out.length ? out : DEFAULT_APPLIED_INDICATORS;
}

// ==================== Store ====================

const LEGACY_LOCALSTORAGE_KEY = "chart-ix-trade-prefs";

interface ChartState {
  appliedIndicators: AppliedIndicator[];
  /** Set once the pre-registry (v1) indicator settings have been folded in. */
  migratedV1: boolean;
  /** Drawings keyed by symbol; shared across intervals since they're time+price anchored. */
  drawings: Record<string, Drawing[]>;
  /** Transient: which drawing tool is armed. Not persisted. */
  activeTool: DrawingTool | null;
  /** Transient: currently selected drawing id. Not persisted. */
  selectedDrawingId: string | null;
  drawingColor: string;
  /** Keep the armed tool after finishing a drawing (TradingView's "magnet"-style pin). */
  keepToolActive: boolean;

  /** Folds this device's v1 localStorage indicator settings in, at most once. */
  runV1MigrationIfNeeded: () => void;
  /** Applies a v1 payload (used by the cross-device sync path). */
  applyLegacyMigration: (legacy: unknown, params: unknown) => void;

  addIndicator: (defId: string, params?: Record<string, number>) => void;
  removeIndicator: (instanceId: string) => void;
  updateIndicatorParams: (instanceId: string, params: Record<string, number>) => void;
  updateIndicatorStyle: (instanceId: string, plotKey: string, patch: PlotStyleOverride) => void;
  toggleIndicatorVisible: (instanceId: string) => void;
  clearIndicators: () => void;
  resetIndicatorToDefaults: (instanceId: string) => void;

  setActiveTool: (tool: DrawingTool | null) => void;
  setDrawingColor: (color: string) => void;
  setKeepToolActive: (v: boolean) => void;
  addDrawing: (
    symbol: string,
    drawing: Omit<Drawing, "id" | "lineWidth" | "lineStyle" | "opacity" | "fontSize"> &
      Partial<Pick<Drawing, "lineWidth" | "lineStyle" | "opacity" | "fontSize">>
  ) => void;
  updateDrawing: (symbol: string, id: string, patch: Partial<Omit<Drawing, "id">>) => void;
  removeDrawing: (symbol: string, id: string) => void;
  clearDrawings: (symbol: string) => void;
  setSelectedDrawing: (id: string | null) => void;
}

/**
 * Reconciles persisted (localStorage) state with the store's fresh defaults.
 * Exported standalone (rather than inlined in the `persist` config) so it can be
 * unit-tested directly without depending on zustand's persist middleware actually
 * attaching storage (it no-ops in non-browser test environments).
 */
export function mergeChartState(
  persisted: unknown,
  current: ChartState
): ChartState {
  const p = (persisted ?? {}) as Partial<ChartState>;
  return {
    ...current,
    ...p,
    // Drop instances whose definition no longer exists so a removed
    // registry entry can't leave an unrenderable ghost in the legend.
    appliedIndicators: (p.appliedIndicators ?? current.appliedIndicators).filter((a) =>
      INDICATOR_BY_ID.has(a.defId)
    ),
    // Backfill style fields on drawings persisted before those fields existed
    // (missing lineWidth/lineStyle/opacity would otherwise render, e.g., rectangles
    // as solid opaque blocks via the SVG default fill-opacity of 1).
    drawings: Object.fromEntries(
      Object.entries(p.drawings ?? current.drawings).map(([sym, ds]) => [
        sym,
        (ds as Partial<Drawing>[]).map(
          (d) =>
            ({
              lineWidth: DEFAULT_DRAWING_LINE_WIDTH,
              lineStyle: DEFAULT_DRAWING_LINE_STYLE,
              opacity: DEFAULT_DRAWING_OPACITY,
              ...d,
            }) as Drawing
        ),
      ])
    ),
  };
}

export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      appliedIndicators: DEFAULT_APPLIED_INDICATORS,
      migratedV1: false,
      drawings: {},
      activeTool: null,
      selectedDrawingId: null,
      drawingColor: DRAWING_COLORS[0],
      keepToolActive: false,

      runV1MigrationIfNeeded: () =>
        set((s) => {
          if (s.migratedV1 || typeof window === "undefined") return s;
          try {
            const raw = window.localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
            if (!raw) return { migratedV1: true };
            const parsed = JSON.parse(raw) as {
              state?: { chartIndicators?: LegacyChartIndicators; indicatorParams?: LegacyParams };
            };
            const legacy = parsed?.state?.chartIndicators;
            if (!legacy) return { migratedV1: true };
            return {
              migratedV1: true,
              appliedIndicators: migrateLegacyIndicators(legacy, parsed?.state?.indicatorParams),
            };
          } catch {
            // Corrupt legacy blob is not worth surfacing — just start from defaults.
            return { migratedV1: true };
          }
        }),

      applyLegacyMigration: (legacy, params) =>
        set(() => ({
          migratedV1: true,
          appliedIndicators: migrateLegacyIndicators(
            legacy as LegacyChartIndicators | undefined,
            params as LegacyParams | undefined
          ),
        })),

      addIndicator: (defId, params) =>
        set((s) => {
          const def = INDICATOR_BY_ID.get(defId);
          if (!def) return s;
          return {
            appliedIndicators: [
              ...s.appliedIndicators,
              {
                instanceId: uid(),
                defId,
                params: { ...defaultParams(def), ...params },
                visible: true,
              },
            ],
          };
        }),

      removeIndicator: (instanceId) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.filter((a) => a.instanceId !== instanceId),
        })),

      updateIndicatorParams: (instanceId, params) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.map((a) =>
            a.instanceId === instanceId ? { ...a, params: { ...a.params, ...params } } : a
          ),
        })),

      updateIndicatorStyle: (instanceId, plotKey, patch) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.map((a) =>
            a.instanceId === instanceId
              ? {
                  ...a,
                  styleOverrides: {
                    ...a.styleOverrides,
                    [plotKey]: { ...a.styleOverrides?.[plotKey], ...patch },
                  },
                }
              : a
          ),
        })),

      toggleIndicatorVisible: (instanceId) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.map((a) =>
            a.instanceId === instanceId ? { ...a, visible: !a.visible } : a
          ),
        })),

      clearIndicators: () => set({ appliedIndicators: [] }),

      resetIndicatorToDefaults: (instanceId) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.map((a) => {
            const def = INDICATOR_BY_ID.get(a.defId);
            return a.instanceId === instanceId && def
              ? { ...a, params: defaultParams(def), styleOverrides: undefined }
              : a;
          }),
        })),

      setActiveTool: (tool) => set({ activeTool: tool, selectedDrawingId: null }),
      setDrawingColor: (drawingColor) => set({ drawingColor }),
      setKeepToolActive: (keepToolActive) => set({ keepToolActive }),

      addDrawing: (symbol, drawing) =>
        set((s) => ({
          drawings: {
            ...s.drawings,
            [symbol]: [
              ...(s.drawings[symbol] ?? []),
              {
                lineWidth: DEFAULT_DRAWING_LINE_WIDTH,
                lineStyle: DEFAULT_DRAWING_LINE_STYLE,
                opacity: DEFAULT_DRAWING_OPACITY,
                fontSize: drawing.tool === "text" ? DEFAULT_DRAWING_FONT_SIZE : undefined,
                ...drawing,
                id: uid(),
              },
            ],
          },
        })),

      updateDrawing: (symbol, id, patch) =>
        set((s) => ({
          drawings: {
            ...s.drawings,
            [symbol]: (s.drawings[symbol] ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
          },
        })),

      removeDrawing: (symbol, id) =>
        set((s) => ({
          drawings: {
            ...s.drawings,
            [symbol]: (s.drawings[symbol] ?? []).filter((d) => d.id !== id),
          },
          selectedDrawingId: s.selectedDrawingId === id ? null : s.selectedDrawingId,
        })),

      clearDrawings: (symbol) =>
        set((s) => ({ drawings: { ...s.drawings, [symbol]: [] }, selectedDrawingId: null })),

      setSelectedDrawing: (selectedDrawingId) => set({ selectedDrawingId }),
    }),
    {
      name: "chart-ix-chart-state",
      // activeTool/selectedDrawingId are per-session UI state, never restored.
      partialize: (s) => ({
        appliedIndicators: s.appliedIndicators,
        migratedV1: s.migratedV1,
        drawings: s.drawings,
        drawingColor: s.drawingColor,
        keepToolActive: s.keepToolActive,
      }),
      merge: (persisted, current) => mergeChartState(persisted, current),
    }
  )
);

/** Convenience: resolve an applied instance to its definition. */
export function resolveDef(a: AppliedIndicator): IndicatorDef | undefined {
  return INDICATOR_BY_ID.get(a.defId);
}
