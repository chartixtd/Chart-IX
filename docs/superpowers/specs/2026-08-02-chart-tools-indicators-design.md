# Chart drawing tools & indicators — expansion + adjustability

## Goal

The user asked for a "complete rewrite" of the chart's drawing tools and indicators to match TradingView's freedom, plus more indicators, plus stronger adjustability (including color) on everything. Literal 100% TradingView parity isn't a real target (Pine Script alone is a separate product), so this scopes down to three concrete, additive changes:

1. **Drawing tools**: 8 new tool types, plus a per-drawing style settings panel (color, line width, line style, fill opacity, font size).
2. **Indicators**: 8 new indicators, plus a per-instance style settings panel (color, line width, line style) for every plot of every indicator already in the registry.
3. **Shared style UI**: a reusable free-color picker and line-style control used by both of the above.

Nothing existing is removed or changed in default appearance — this is additive. A user who never touches the new settings sees the chart exactly as before.

## Current state (verified in code)

- `src/stores/chartStore.ts` — Zustand store, persisted to localStorage. `Drawing` currently has only `color` as a style field. `AppliedIndicator` has no style field at all (`params: Record<string, number>` only); indicator colors/line styles are hardcoded per-plot in the registry (`src/lib/chart/indicator-registry.ts`, `plots[].color` / `lineStyle`).
- `src/components/trade/chart/DrawingToolbar.tsx` — 7 tools (trendline, ray, hline, vline, rect, fib, text), fixed 6-swatch color palette, no per-drawing settings entry point.
- `src/components/trade/chart/DrawingLayer.tsx` (464 lines) — renders/hit-tests drawings anchored in time+price space; handles point-count-driven creation (2-point line tools, 1-point line tools, etc).
- `src/components/trade/chart/IndicatorModal.tsx` — indicator browser + applied list; each applied instance has a gear icon opening an inline panel of **numeric-only** param inputs (period, multiplier). No color/line controls exist here despite the registry defining per-plot colors.
- `src/lib/chart/indicator-registry.ts` (429 lines) — ~30 indicators already defined (MA/EMA/WMA/DEMA/TEMA/VWMA/VWAP/SAR/SuperTrend/Ichimoku/ADX/Aroon/BB/KC/Donchian/Envelope/ATR/StdDev/RSI/MACD/Stoch/CCI/WillR/Momentum/ROC/TRIX/CMO/DPO/UO/Volume/OBV/MFI/CMF). Each entry: `{id, name, short, category, placement, params, plots, compute}`.
- `src/lib/indicators.ts` (812 lines) — pure calculation functions (`computeMA`, `computeRSI`, etc.) that the registry's `compute` fields call into.

## 1. Shared style components

New files under `src/components/trade/chart/`:

- **`ColorPicker.tsx`** — hex text input + native `<input type="color">` swatch + a row of ~8 quick-pick presets (reuse `DRAWING_COLORS` as the preset set). Controlled component: `{ value: string; onChange: (hex: string) => void }`.
- **`LineStyleControl.tsx`** — two button groups: width (1/2/3/4px, shown as increasingly thick line-icons) and dash style (solid/dashed/dotted). Controlled: `{ width, style, onChange }`.

Both are presentational, chart-library-agnostic, and independently testable (no canvas/lightweight-charts dependency).

## 2. Drawing tools

### Data model (`chartStore.ts`)

```ts
export type DrawingTool =
  | "trendline" | "ray" | "hline" | "vline" | "rect" | "fib" | "text"
  | "channel" | "fib-extension" | "fib-fan"
  | "circle" | "triangle" | "arrow"
  | "price-range" | "date-range";

export interface Drawing {
  id: string;
  tool: DrawingTool;
  points: DrawingPoint[];
  color: string;
  lineWidth: 1 | 2 | 3 | 4;      // default 2, matches current rendering
  lineStyle: "solid" | "dashed" | "dotted"; // default "solid"
  opacity: number;                // 0-1, fill opacity for shapes/channel/rect; default 0.15
  fontSize?: number;              // text tool only; default 12
  text?: string;
}
```

`DRAWING_TOOLS` registry gains 8 new entries with their point counts:
- `channel` (3 points: two anchor a trendline, third sets the parallel offset)
- `fib-extension`, `fib-fan` (2-3 points, same anchor pattern as existing `fib`)
- `circle`, `triangle`, `arrow` (2 points: bounding box / direction)
- `price-range`, `date-range` (2 points; renders a floating label with computed Δ% or Δtime, no persistent line needed beyond the two anchors)

### Rendering (`DrawingLayer.tsx`)

Each new tool follows the exact pattern already used for `rect`/`fib` (point-count-driven creation, time/price-anchored coordinates recalculated on pan/zoom). Fill-capable shapes (`rect`, `channel`, `circle`, `triangle`) use `opacity` for their fill; line-only tools ignore it. `lineWidth`/`lineStyle` feed directly into the SVG stroke props (`stroke-width`, `stroke-dasharray`) alongside the existing `color`.

### Interaction

- `DrawingToolbar.tsx` adds icons for the 8 new tools in the existing button list; the fixed color-swatch picker is replaced by opening the new `ColorPicker` in a small popover (still sets `drawingColor`, the color new drawings start with).
- Double-clicking a finished drawing opens a `Modal` (reusing `ColorPicker` + `LineStyleControl`, plus a font-size stepper when `tool === "text"`) that edits that one drawing's style fields via `updateDrawing(symbol, id, patch)` (already exists).

## 3. Indicators

### Data model (`chartStore.ts`)

```ts
export interface AppliedIndicator {
  instanceId: string;
  defId: string;
  params: Record<string, number>;
  visible: boolean;
  styleOverrides?: Record<string, Partial<{ color: string; lineWidth: number; lineStyle: "solid" | "dashed" | "dotted" }>>;
  // keyed by plot key, e.g. { ma: { color: "#ff0000" } }
}
```

`resolveDef`-adjacent helper (new `resolvePlotStyle(def, applied, plotKey)`) merges: registry default plot style ← `styleOverrides[plotKey]` when present. Every place that currently reads `def.plots[i].color` directly (chart rendering, `ChartLegend.tsx`, the modal's swatch dot) switches to this resolver instead — additive, defaults unchanged when no override exists.

### UI (`IndicatorModal.tsx`)

The existing per-instance settings panel (currently just numeric param `<input>`s) gets one row per plot: plot label + `ColorPicker` + `LineStyleControl`, using the resolver's current value and writing through a new store action `updateIndicatorStyle(instanceId, plotKey, patch)`. "恢复默认参数" (reset) also clears `styleOverrides` for that instance.

### New indicators (`src/lib/indicators.ts` + `indicator-registry.ts`)

Following the exact existing pattern (pure `compute` function in `indicators.ts`, registry entry with params/plots/compute in `indicator-registry.ts`):

| Indicator | Category | Placement |
|---|---|---|
| KDJ | momentum | pane |
| Stochastic RSI | momentum | pane |
| Awesome Oscillator | momentum | pane |
| Hull MA (HMA) | trend | main |
| Williams Alligator | trend | main |
| Pivot Points (Standard) | trend | main |
| Chaikin Oscillator | volume | pane |
| Vortex Indicator | trend | pane |

## Testing

- `src/lib/indicators.test.ts` (new file — none currently exists for this module): one test per new `compute*` function against a known small input.
- `src/lib/chart/indicator-registry.test.ts`: extend for the 8 new registry entries (id lookup, default params, plot resolution) matching existing test patterns.
- `ColorPicker`/`LineStyleControl`: basic render + onChange tests (no chart dependency).
- `chartStore` tests (if present) extended for `updateIndicatorStyle` and the new `Drawing` style fields' defaults on `addDrawing`.
- No visual/browser verification is possible in this environment without a way to interactively drag on the chart canvas — implementation should be verified by the user after deploy, same as prior chart-related work this session.

## Out of scope (explicitly not doing)

- Pine Script or any custom-indicator scripting language.
- Multi-chart layouts, replay mode, alerts-from-drawings, or any other TradingView feature beyond drawing tools + indicator styling.
- Changing the visual default of any existing drawing or indicator.
