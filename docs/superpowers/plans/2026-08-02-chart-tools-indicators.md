# Chart Drawing Tools & Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the K-line chart's drawing tools (7 → 15) and indicators (30 → 38), and make every drawing's and every indicator plot's color/line-width/line-style adjustable after the fact.

**Architecture:** Additive changes only — no existing drawing or indicator changes appearance by default. Drawing style lives on the `Drawing` object in `chartStore.ts` (already partially there via `color`); indicator style lives in a new optional `styleOverrides` map per applied instance, resolved against the registry's static defaults at render time. New drawing tools extend `DrawingLayer.tsx`'s existing point-count-driven creation/render pattern. New indicators extend `indicators.ts` (pure compute functions) + `indicator-registry.ts` (declarative metadata), the existing pattern for all 30 current indicators.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand (+ `persist` middleware), `lightweight-charts`, Vitest.

## Global Constraints

- No existing drawing's or indicator's default color/width/style changes — every new field has a default matching current hardcoded behavior.
- This codebase has no React component test harness (no `@testing-library/react`, no jsdom/happy-dom — `vitest.config.ts` runs with `environment: "node"`). Tasks that only add UI (no new pure logic) are verified by manual browser check, not automated tests — do not invent component tests that can't actually run.
- Pure-logic changes (Zustand store actions, `src/lib/indicators.ts` compute functions, registry entries) get real Vitest TDD cycles, matching the existing test style in `src/lib/chart/indicator-registry.test.ts`.
- `vitest.config.ts`'s `test.include` currently only covers `src/lib/trading/**`, `src/lib/bingx/**`, `src/lib/chart/**` — it does not cover `src/lib/indicators.ts` (sits directly under `src/lib/`) or anything under `src/stores/`. Task 2 fixes this once, up front.
- Follow existing code style: Chinese comments/labels where the surrounding file already uses Chinese (chartStore, indicator-registry, toolbar labels); English is fine for new internal-only identifiers.

---

## Task 1: Shared style controls — `ColorPicker` and `LineStyleControl`

**Files:**
- Create: `src/components/trade/chart/ColorPicker.tsx`
- Create: `src/components/trade/chart/LineStyleControl.tsx`

**Interfaces:**
- Produces: `ColorPicker({ value: string; onChange: (hex: string) => void; presets?: string[] })` — default `presets` falls back to the existing `DRAWING_COLORS` array from `@/stores/chartStore`.
- Produces: `LineStyleControl({ width: 1 | 2 | 3 | 4; style: "solid" | "dashed" | "dotted"; onWidthChange: (w: 1 | 2 | 3 | 4) => void; onStyleChange: (s: "solid" | "dashed" | "dotted") => void })`.

No pure-logic to unit test here (Global Constraints) — verify by rendering both in a throwaway spot and checking in the browser, then remove the throwaway usage before committing.

- [ ] **Step 1: Write `ColorPicker.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DRAWING_COLORS } from "@/stores/chartStore";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  presets?: string[];
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ColorPicker({ value, onChange, presets = DRAWING_COLORS }: ColorPickerProps) {
  const [text, setText] = useState(value);

  const commit = (v: string) => {
    setText(v);
    if (HEX_RE.test(v)) onChange(v);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="relative h-6 w-6 shrink-0 overflow-hidden rounded-xs border border-border-default">
        <input
          type="color"
          value={HEX_RE.test(value) ? value : "#000000"}
          onChange={(e) => commit(e.target.value)}
          className="absolute -left-1 -top-1 h-8 w-8 cursor-pointer border-none bg-transparent p-0"
          aria-label="选取颜色"
        />
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(value)}
        placeholder="#c9a24b"
        className="w-20 rounded-xs border border-border-default bg-bg-primary px-1.5 py-0.5 font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => commit(c)}
            title={c}
            className={cn(
              "h-3.5 w-3.5 rounded-full border transition-transform",
              value === c ? "scale-125 border-text-primary" : "border-transparent"
            )}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `LineStyleControl.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

interface LineStyleControlProps {
  width: 1 | 2 | 3 | 4;
  style: DrawingLineStyle;
  onWidthChange: (w: 1 | 2 | 3 | 4) => void;
  onStyleChange: (s: DrawingLineStyle) => void;
}

const WIDTHS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
const STYLES: { value: DrawingLineStyle; label: string; dasharray?: string }[] = [
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线", dasharray: "4 3" },
  { value: "dotted", label: "点线", dasharray: "1 2" },
];

export function LineStyleControl({ width, style, onWidthChange, onStyleChange }: LineStyleControlProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onWidthChange(w)}
            title={`${w}px`}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-xs border transition-colors",
              width === w ? "border-gold bg-gold/10" : "border-border-default hover:border-gold/40"
            )}
          >
            <svg width="16" height="8" viewBox="0 0 16 8">
              <line x1="1" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth={w} className="text-text-primary" />
            </svg>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStyleChange(s.value)}
            title={s.label}
            className={cn(
              "flex h-6 w-8 items-center justify-center rounded-xs border transition-colors",
              style === s.value ? "border-gold bg-gold/10" : "border-border-default hover:border-gold/40"
            )}
          >
            <svg width="20" height="8" viewBox="0 0 20 8">
              <line x1="1" y1="4" x2="19" y2="4" stroke="currentColor" strokeWidth={1.5} strokeDasharray={s.dasharray} className="text-text-primary" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Temporarily render `<ColorPicker value="#c9a24b" onChange={console.log} />` and `<LineStyleControl width={2} style="solid" onWidthChange={console.log} onStyleChange={console.log} />` inside `IndicatorModal.tsx` (top of the modal body), start the dev server, open the indicator modal in the browser, confirm both render without console errors and clicking swatches/buttons logs the expected values. Remove the temporary usage afterward.

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/chart/ColorPicker.tsx src/components/trade/chart/LineStyleControl.tsx
git commit -m "feat(chart): add reusable ColorPicker and LineStyleControl"
```

---

## Task 2: Drawing data model — style fields, 8 new tool types, test config fix

**Files:**
- Modify: `vitest.config.ts`
- Modify: `src/stores/chartStore.ts`
- Create: `src/stores/chartStore.test.ts`

**Interfaces:**
- Produces: `DrawingTool` union gains `"channel" | "fib-extension" | "fib-fan" | "circle" | "triangle" | "arrow" | "price-range" | "date-range"`.
- Produces: `Drawing` gains `lineWidth: 1|2|3|4`, `lineStyle: "solid"|"dashed"|"dotted"`, `opacity: number`, `fontSize?: number` (all with store-applied defaults, so existing 3-field call sites in `DrawingLayer.tsx` keep compiling unchanged).
- Produces: `DRAWING_TOOLS` (already exported, currently unused elsewhere) becomes the single source of truth for tool label + point count, consumed by Task 3.
- Produces: `DEFAULT_DRAWING_LINE_WIDTH`, `DEFAULT_DRAWING_LINE_STYLE`, `DEFAULT_DRAWING_OPACITY`, `DEFAULT_DRAWING_FONT_SIZE` constants.

- [ ] **Step 1: Fix vitest include globs so new test locations run**

In `vitest.config.ts`, replace:

```ts
    include: [
      "src/lib/trading/**/*.test.ts",
      "src/lib/bingx/**/*.test.ts",
      "src/lib/chart/**/*.test.ts",
    ],
```

with:

```ts
    include: [
      "src/lib/**/*.test.ts",
      "src/stores/**/*.test.ts",
    ],
```

(`src/lib/**/*.test.ts` is a superset of the three prior entries, plus it now covers `src/lib/indicators.test.ts` added in Task 13.)

- [ ] **Step 2: Write the failing test**

Create `src/stores/chartStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useChartStore, DEFAULT_DRAWING_LINE_WIDTH, DEFAULT_DRAWING_LINE_STYLE, DEFAULT_DRAWING_OPACITY } from "./chartStore";

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
  it("has an entry for every DrawingTool the toolbar/layer support, including the 8 new ones", () => {
    const tools = ["trendline", "ray", "hline", "vline", "rect", "fib", "text",
      "channel", "fib-extension", "fib-fan", "circle", "triangle", "arrow", "price-range", "date-range"];
    const { DRAWING_TOOLS } = useChartStore.getState() as unknown as { DRAWING_TOOLS?: never };
    void DRAWING_TOOLS; // DRAWING_TOOLS is a module export, not store state — imported separately below
    expect(tools.length).toBe(15);
  });
});
```

Replace the last `DRAWING_TOOLS` test with a direct import instead (Zustand state doesn't hold module-level constants):

```ts
import { useChartStore, DEFAULT_DRAWING_LINE_WIDTH, DEFAULT_DRAWING_LINE_STYLE, DEFAULT_DRAWING_OPACITY, DRAWING_TOOLS } from "./chartStore";
```

and:

```ts
describe("DRAWING_TOOLS", () => {
  it("has exactly one entry per DrawingTool, 15 total after the new tools", () => {
    expect(DRAWING_TOOLS.length).toBe(15);
    expect(new Set(DRAWING_TOOLS.map((t) => t.tool)).size).toBe(15);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- chartStore`
Expected: FAIL — `chartStore.ts` has no `DEFAULT_DRAWING_LINE_WIDTH` export yet, and `DRAWING_TOOLS` currently has 7 entries.

- [ ] **Step 4: Implement**

In `src/stores/chartStore.ts`, replace the `DrawingTool`/`Drawing`/`DRAWING_TOOLS` block:

```ts
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
export const DEFAULT_DRAWING_OPACITY = 0.15;
export const DEFAULT_DRAWING_FONT_SIZE = 12;
```

Update the `addDrawing` action signature and implementation. In the `ChartState` interface:

```ts
  addDrawing: (
    symbol: string,
    drawing: Omit<Drawing, "id" | "lineWidth" | "lineStyle" | "opacity" | "fontSize"> &
      Partial<Pick<Drawing, "lineWidth" | "lineStyle" | "opacity" | "fontSize">>
  ) => void;
```

In the store implementation, replace the `addDrawing` action body:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- chartStore`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: all tests pass (the vitest include change should only add coverage, not remove any)

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/stores/chartStore.ts src/stores/chartStore.test.ts
git commit -m "feat(chart): extend Drawing with style fields and 8 new tool types"
```

---

## Task 3: `DrawingToolbar` — new tool icons + free color picker

**Files:**
- Modify: `src/components/trade/chart/DrawingToolbar.tsx`

**Interfaces:**
- Consumes: `DRAWING_TOOLS` from Task 2 (`{ tool, label, points }[]`), `ColorPicker` from Task 1.

No pure logic here — manual verification only (Global Constraints).

- [ ] **Step 1: Replace the local `TOOLS` array and icon map with the full 15-tool set, driven by `DRAWING_TOOLS`**

Replace the top of `DrawingToolbar.tsx` (imports and the `ICON`/`TOOLS` constants) with:

```tsx
"use client";

import { useState } from "react";
import { useChartStore, DRAWING_TOOLS, type DrawingTool } from "@/stores/chartStore";
import { ColorPicker } from "./ColorPicker";
import { cn } from "@/lib/utils";

const ICON: Record<DrawingTool, React.ReactNode> = {
  trendline: <path d="M3 17L17 5" />,
  ray: <><path d="M3 17L16 6" /><path d="M11 5h6v6" /></>,
  hline: <path d="M2 10h16" />,
  vline: <path d="M10 2v16" />,
  rect: <rect x="3" y="5" width="14" height="10" rx="1" />,
  fib: <><path d="M2 4h16" /><path d="M2 8h16" /><path d="M2 12h16" /><path d="M2 16h16" /></>,
  text: <><path d="M4 4h12" /><path d="M10 4v12" /></>,
  channel: <><path d="M2 15L17 4" /><path d="M3 17L18 6" /></>,
  "fib-extension": <><path d="M2 4h16" /><path d="M2 10h16" /><path d="M2 16h16" /><path d="M2 2L18 18" strokeDasharray="1.5 1.5" /></>,
  "fib-fan": <><path d="M2 18L18 2" /><path d="M2 18L18 8" /><path d="M2 18L18 14" /></>,
  circle: <circle cx="10" cy="10" r="7" />,
  triangle: <path d="M10 3l7 14H3z" />,
  arrow: <><path d="M3 17L17 3" /><path d="M8 3h9v9" /></>,
  "price-range": <><path d="M4 3v14" /><path d="M16 3v14" /><path d="M4 10h12" /></>,
  "date-range": <><path d="M3 4h14" /><path d="M3 16h14" /><path d="M10 4v12" /></>,
};

export function DrawingToolbar({ symbol }: { symbol: string }) {
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const drawingColor = useChartStore((s) => s.drawingColor);
  const setDrawingColor = useChartStore((s) => s.setDrawingColor);
  const keepToolActive = useChartStore((s) => s.keepToolActive);
  const setKeepToolActive = useChartStore((s) => s.setKeepToolActive);
  const selectedDrawingId = useChartStore((s) => s.selectedDrawingId);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const clearDrawings = useChartStore((s) => s.clearDrawings);
  const count = useChartStore((s) => s.drawings[symbol]?.length ?? 0);
```

- [ ] **Step 2: Replace the tools loop and the fixed swatch grid**

Replace:

```tsx
      {TOOLS.map(({ tool, label }) => (
```

with:

```tsx
      {DRAWING_TOOLS.map(({ tool, label }) => (
```

(the rest of that `.map` body is unchanged — `key={tool}`, `onClick`, `title={label}`, `ICON[tool]`).

Replace the fixed color-swatch grid block:

```tsx
      {/* Colour swatches */}
      <div className="grid grid-cols-2 gap-0.5 px-1">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setDrawingColor(c)}
            title="线条颜色"
            className={cn(
              "h-3 w-3 rounded-full border transition-transform",
              drawingColor === c ? "scale-125 border-text-primary" : "border-transparent"
            )}
            style={{ background: c }}
          />
        ))}
      </div>
```

with a single swatch button that opens a `ColorPicker` popover:

```tsx
      {/* Colour picker (free colour, not just fixed swatches) */}
      <div className="relative">
        <button
          onClick={() => setColorPopoverOpen((o) => !o)}
          title="线条颜色"
          className="flex h-7 w-7 items-center justify-center rounded-xs hover:bg-bg-tertiary"
        >
          <span className="h-3.5 w-3.5 rounded-full border border-text-primary/40" style={{ background: drawingColor }} />
        </button>
        {colorPopoverOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setColorPopoverOpen(false)} />
            <div className="absolute left-9 top-0 z-20 rounded-sm border border-border-default bg-bg-secondary p-2 shadow-modal">
              <ColorPicker value={drawingColor} onChange={setDrawingColor} />
            </div>
          </>
        )}
      </div>
```

`DRAWING_COLORS` is no longer imported directly in this file (it's `ColorPicker`'s default `presets`) — remove it from the `useChartStore` import line, keeping `DRAWING_TOOLS` and `type DrawingTool`.

- [ ] **Step 3: Manual verification**

Start the dev server, open `/trade`, open the drawing toolbar (Pro-gated — use a Pro test account or temporarily bypass `isAllowed`/`hasAdvancedChart` locally per existing dev conventions), confirm: all 15 tool icons render and are clickable (armed state highlights gold), the color button opens a popover with the free `ColorPicker`, picking a color updates the swatch and closes on outside click.

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/chart/DrawingToolbar.tsx
git commit -m "feat(chart): drive toolbar from DRAWING_TOOLS, add free color picker"
```

---

## Task 4: `DrawingLayer` — apply per-drawing style to the 7 existing tools

**Files:**
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

**Interfaces:**
- Consumes: `Drawing.lineWidth`, `Drawing.lineStyle`, `Drawing.opacity` from Task 2.

Manual verification only (rendering logic, no pure function to unit test).

- [ ] **Step 1: Add a dash-array lookup and use per-drawing width/style/opacity in `renderShape`**

Add near the top of the file, after `FIB_LEVELS`:

```ts
const DASH_ARRAY: Record<Drawing["lineStyle"], string | undefined> = {
  solid: undefined,
  dashed: "6 4",
  dotted: "1.5 3",
};
```

In `renderShape`, replace the `common` object:

```ts
    const common = {
      stroke,
      strokeWidth: sel ? d.lineWidth + 0.5 : d.lineWidth,
      fill: "none",
      strokeDasharray: isDraft ? "4 3" : DASH_ARRAY[d.lineStyle],
      vectorEffect: "non-scaling-stroke" as const,
    };
```

In the `rect` branch, replace both hardcoded `fillOpacity={0.08}` occurrences with `fillOpacity={d.opacity}`.

In the draft preview at the bottom of the component (`draft && renderShape({ id: "__draft__", tool: draft.tool, points: [draft.a, draft.b], color: drawingColor }, true)`), the draft object is missing the new required fields — extend it:

```tsx
        {draft &&
          renderShape(
            {
              id: "__draft__",
              tool: draft.tool,
              points: [draft.a, draft.b],
              color: drawingColor,
              lineWidth: 2,
              lineStyle: "solid",
              opacity: 0.15,
            },
            true
          )}
```

- [ ] **Step 2: Manual verification**

Draw a trendline and a rectangle, then (once Task 6's settings modal exists — for now, use the browser devtools to call `useChartStore.getState().updateDrawing(symbol, drawingId, { lineWidth: 4, lineStyle: "dashed" })` directly in the console) confirm the line visibly thickens and dashes.

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): render existing drawing tools with per-drawing width/style/opacity"
```

---

## Task 5: `DrawingLayer` — parallel channel (3-point tool)

**Files:**
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

**Interfaces:**
- Consumes: `DRAWING_TOOLS` (Task 2) to know `channel` needs 3 points.
- Produces: a generalized "pending third point" interaction, reusable by nothing else in this plan but structured so it could be (only `channel` uses 3 points among the 15 tools).

- [ ] **Step 1: Add 3-point draft state and wire it into the pointer handlers**

Add a new piece of state next to `draft`:

```ts
  // Third-point pending state, only used by 3-point tools (currently: channel only)
  const [pendingChannel, setPendingChannel] = useState<{ a: DrawingPoint; b: DrawingPoint } | null>(null);
```

In `onCapturePointerUp`, after the existing `addDrawing` call for the normal 2-point drag, branch `channel` into the pending-third-point flow instead of committing immediately:

```ts
  const onCapturePointerUp = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!draft) return;
    const p = pointFromEvent(e) ?? draft.b;
    const moved = p.time !== draft.a.time || p.price !== draft.a.price;
    if (moved) {
      if (draft.tool === "channel") {
        setPendingChannel({ a: draft.a, b: p });
        setDraft(null);
        return; // wait for the third click (channel offset) instead of finishing here
      }
      addDrawing(symbol, { tool: draft.tool, points: [draft.a, p], color: drawingColor });
    }
    setDraft(null);
    if (!keepToolActive) setActiveTool(null);
  };
```

In `onCapturePointerDown`, handle the third click when `pendingChannel` is set (this takes priority over starting a new draft):

```ts
  const onCapturePointerDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!activeTool) return;
    const p = pointFromEvent(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pendingChannel) {
      addDrawing(symbol, {
        tool: "channel",
        points: [pendingChannel.a, pendingChannel.b, p],
        color: drawingColor,
      });
      setPendingChannel(null);
      if (!keepToolActive) setActiveTool(null);
      return;
    }

    if (activeTool === "text") {
      setPendingText(p);
      setTextValue("");
      return;
    }
    if (ONE_POINT_TOOLS.has(activeTool)) {
      addDrawing(symbol, { tool: activeTool, points: [p], color: drawingColor });
      if (!keepToolActive) setActiveTool(null);
      return;
    }
    setDraft({ tool: activeTool, a: p, b: p });
  };
```

Also clear `pendingChannel` on Escape — in the keydown effect, add `setPendingChannel(null);` alongside the existing `setDraft(null); setPendingText(null);` lines.

- [ ] **Step 2: Render the channel (both the third-point preview and the committed drawing)**

In `renderShape`, add a `channel` branch after the `rect` branch (channel has 3 points, so it needs its own point extraction rather than the shared `[a, b]` destructure used by the 2-point tools):

```tsx
    if (d.tool === "channel") {
      const [pa, pb, pc] = d.points;
      if (!pb) return null;
      const ax = xOf(pa.time), ay = yOf(pa.price);
      const bx = xOf(pb.time), by = yOf(pb.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      // Offset line: parallel to A-B, passing through the third point (or a small default offset while pending).
      const offsetPrice = pc ? pc.price - (pa.price + ((pb.price - pa.price) * (pc.time - pa.time)) / (pb.time - pa.time || 1)) : 0;
      const cy1 = yOf(pa.price + offsetPrice);
      const cy2 = yOf(pb.price + offsetPrice);
      if (cy1 === null || cy2 === null) return null;
      return (
        <g key={d.id}>
          <line x1={ax} y1={ay} x2={bx} y2={by} {...hit} />
          <line x1={ax} y1={ay} x2={bx} y2={by} {...common} />
          <line x1={ax} y1={cy1} x2={bx} y2={cy2} {...common} />
          <line x1={ax} y1={ay} x2={ax} y2={cy1} stroke={stroke} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2 3" />
          {sel && (
            <>
              <circle cx={ax} cy={ay} r={3.5} fill={stroke} />
              <circle cx={bx} cy={by} r={3.5} fill={stroke} />
              <circle cx={ax} cy={cy1} r={3.5} fill={stroke} />
            </>
          )}
        </g>
      );
    }
```

Move this branch to sit before the `if (!b) return null;` line, since it destructures its own points instead of relying on the shared `[a, b]`.

Render the live pending-channel preview (first two points fixed, third tracking the pointer) right after the existing `draft && renderShape(...)` block:

```tsx
        {pendingChannel && (
          <line
            x1={xOf(pendingChannel.a.time) ?? 0}
            y1={yOf(pendingChannel.a.price) ?? 0}
            x2={xOf(pendingChannel.b.time) ?? 0}
            y2={yOf(pendingChannel.b.price) ?? 0}
            stroke={drawingColor}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}
```

- [ ] **Step 3: Manual verification**

Select the "平行通道" tool, drag a trendline (first two points), then click a third point to set the channel width — confirm a second parallel line appears at that offset and the drawing persists after releasing the tool.

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): add parallel channel drawing tool (3-point)"
```

---

## Task 6: `DrawingLayer` — Fibonacci extension & fan

**Files:**
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

**Interfaces:**
- Consumes: the existing 2-point draft flow (no interaction changes needed — both are 2-point tools like `fib`).

- [ ] **Step 1: Add level constants and render branches**

Near `FIB_LEVELS`, add:

```ts
const FIB_EXTENSION_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
```

(`fib-fan` reuses `FIB_LEVELS`.)

Add both branches in `renderShape`, after the existing `fib` branch (still inside the `if (!b) return null;` guarded section, since both are 2-point tools):

```tsx
    if (d.tool === "fib-extension") {
      const lo = Math.min(x1, x2);
      const hi = Math.max(x1, x2);
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          {FIB_EXTENSION_LEVELS.map((lvl) => {
            const price = a.price + (b.price - a.price) * lvl;
            const y = yOf(price);
            if (y === null) return null;
            return (
              <g key={lvl}>
                <line
                  x1={lo} y1={y} x2={hi} y2={y}
                  stroke={stroke}
                  strokeWidth={sel ? 1.5 : 1}
                  strokeOpacity={lvl === 0 || lvl === 1 ? 0.9 : 0.55}
                  strokeDasharray={lvl === 0 || lvl === 1 ? undefined : "3 3"}
                />
                <text x={lo + 2} y={y - 3} fill={stroke} fontSize={9} fontFamily="monospace" opacity={0.85}>
                  {(lvl * 100).toFixed(1)}% {price.toPrecision(6)}
                </text>
              </g>
            );
          })}
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "fib-fan") {
      const dx = x2 - x1;
      const dy0 = y2 - y1;
      const len = Math.hypot(dx, dy0) || 1;
      const scale = (W + H) / len;
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          {FIB_LEVELS.filter((l) => l > 0).map((lvl) => {
            const targetPrice = a.price + (b.price - a.price) * lvl;
            const ty = yOf(targetPrice);
            if (ty === null) return null;
            const rdx = x2 - x1;
            const rdy = ty - y1;
            const rlen = Math.hypot(rdx, rdy) || 1;
            const rscale = (W + H) / rlen;
            return (
              <line
                key={lvl}
                x1={x1} y1={y1}
                x2={x1 + rdx * rscale} y2={y1 + rdy * rscale}
                stroke={stroke}
                strokeWidth={sel ? 1.5 : 1}
                strokeOpacity={0.6}
              />
            );
          })}
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }
```

(`scale`/`dx`/`dy0`/`len` computed for `fib-fan`'s outer scope are unused after the refactor to per-level `rscale` — remove the unused outer `dx`/`dy0`/`len`/`scale` declarations to avoid an unused-variable lint warning, keeping only the per-level `rdx`/`rdy`/`rlen`/`rscale`.)

- [ ] **Step 2: Manual verification**

Draw both tools on the chart; confirm `fib-extension` shows 7 horizontal levels including the >100% ones, and `fib-fan` shows diagonal rays fanning out from the first point through the 6 non-zero Fibonacci levels at the second point's time.

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): add Fibonacci extension and fan drawing tools"
```

---

## Task 7: `DrawingLayer` — shape annotations (circle, triangle, arrow)

**Files:**
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

- [ ] **Step 1: Render branches**

Add after the `rect` branch:

```tsx
    if (d.tool === "circle") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      return (
        <g key={d.id}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={stroke} fillOpacity={d.opacity} stroke="transparent" strokeWidth={12}
            style={{ pointerEvents: (activeTool ? "none" : "all") as "none" | "all", cursor: "move" }}
            onPointerDown={(e) => onShapePointerDown(e, d)} onPointerMove={onShapePointerMove} onPointerUp={onShapePointerUp} />
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} fill={stroke} fillOpacity={d.opacity} />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "triangle") {
      const points = `${(x1 + x2) / 2},${Math.min(y1, y2)} ${x1},${Math.max(y1, y2)} ${x2},${Math.max(y1, y2)}`;
      return (
        <g key={d.id}>
          <polygon points={points} fill={stroke} fillOpacity={d.opacity} stroke="transparent" strokeWidth={12}
            style={{ pointerEvents: (activeTool ? "none" : "all") as "none" | "all", cursor: "move" }}
            onPointerDown={(e) => onShapePointerDown(e, d)} onPointerMove={onShapePointerMove} onPointerUp={onShapePointerUp} />
          <polygon points={points} {...common} fill={stroke} fillOpacity={d.opacity} />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10;
      const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          <polyline points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`} fill="none" stroke={stroke} strokeWidth={common.strokeWidth} vectorEffect="non-scaling-stroke" />
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }
```

- [ ] **Step 2: Manual verification**

Draw a circle, triangle, and arrow; confirm each renders filled/stroked with the current `drawingColor`, is draggable when selected, and the arrow's head points toward the second click point.

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): add circle, triangle, and arrow annotation tools"
```

---

## Task 8: `DrawingLayer` — measure tools (price range, date range)

**Files:**
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

- [ ] **Step 1: Render branches**

Add after the `arrow` branch:

```tsx
    if (d.tool === "price-range") {
      const deltaPrice = b.price - a.price;
      const deltaPct = a.price !== 0 ? (deltaPrice / a.price) * 100 : 0;
      const midY = (y1 + y2) / 2;
      const up = deltaPrice >= 0;
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x1} y2={y2} {...hit} />
          <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
            fill={up ? "#22c55e" : "#ef4444"} fillOpacity={0.1} stroke="transparent" strokeWidth={0} />
          <line x1={x1} y1={y1} x2={x1} y2={y2} stroke={stroke} strokeWidth={common.strokeWidth} strokeDasharray={DASH_ARRAY[d.lineStyle]} vectorEffect="non-scaling-stroke" />
          <text x={Math.min(x1, x2) + 4} y={midY} fill={up ? "#22c55e" : "#ef4444"} fontSize={11} fontFamily="monospace" fontWeight={600}>
            {deltaPrice >= 0 ? "+" : ""}{deltaPrice.toPrecision(6)} ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%)
          </text>
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x1} cy={y2} r={3.5} fill={stroke} /></>}
        </g>
      );
    }

    if (d.tool === "date-range") {
      const deltaSeconds = Math.abs(b.time - a.time);
      const bars = times.filter((t) => t >= Math.min(a.time, b.time) && t <= Math.max(a.time, b.time)).length;
      const midX = (x1 + x2) / 2;
      const label = deltaSeconds >= 86400
        ? `${(deltaSeconds / 86400).toFixed(1)}天 (${bars}根)`
        : `${(deltaSeconds / 3600).toFixed(1)}小时 (${bars}根)`;
      return (
        <g key={d.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y1} {...hit} />
          <line x1={x1} y1={y1} x2={x2} y2={y1} stroke={stroke} strokeWidth={common.strokeWidth} strokeDasharray={DASH_ARRAY[d.lineStyle]} vectorEffect="non-scaling-stroke" />
          <text x={midX} y={y1 - 6} fill={stroke} fontSize={11} fontFamily="monospace" fontWeight={600} textAnchor="middle">
            {label}
          </text>
          {sel && <><circle cx={x1} cy={y1} r={3.5} fill={stroke} /><circle cx={x2} cy={y1} r={3.5} fill={stroke} /></>}
        </g>
      );
    }
```

- [ ] **Step 2: Manual verification**

Draw both measure tools between two visible points; confirm `price-range` shows a tinted (green if up, red if down) box with the price delta and percentage, and `date-range` shows the elapsed time and bar count.

- [ ] **Step 3: Commit**

```bash
git add src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): add price-range and date-range measure tools"
```

---

## Task 9: `DrawingSettingsModal` — double-click to edit a drawing's style

**Files:**
- Create: `src/components/trade/chart/DrawingSettingsModal.tsx`
- Modify: `src/components/trade/chart/DrawingLayer.tsx`

**Interfaces:**
- Consumes: `ColorPicker`, `LineStyleControl` (Task 1), `Modal` (`@/components/ui/Modal`), `updateDrawing` (existing store action).
- Produces: `DrawingSettingsModal({ symbol, drawing, onClose })`.

- [ ] **Step 1: Write the modal**

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useChartStore, type Drawing } from "@/stores/chartStore";
import { ColorPicker } from "./ColorPicker";
import { LineStyleControl } from "./LineStyleControl";

export function DrawingSettingsModal({
  symbol,
  drawing,
  onClose,
}: {
  symbol: string;
  drawing: Drawing;
  onClose: () => void;
}) {
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const [fontSize, setFontSize] = useState(drawing.fontSize ?? 12);

  const showFill = drawing.tool === "rect" || drawing.tool === "channel" || drawing.tool === "circle" || drawing.tool === "triangle";
  const showFontSize = drawing.tool === "text";

  return (
    <Modal open onClose={onClose} title="图形设置" size="sm">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-text-muted">颜色</p>
          <ColorPicker value={drawing.color} onChange={(color) => updateDrawing(symbol, drawing.id, { color })} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-text-muted">线宽 / 线型</p>
          <LineStyleControl
            width={drawing.lineWidth}
            style={drawing.lineStyle}
            onWidthChange={(lineWidth) => updateDrawing(symbol, drawing.id, { lineWidth })}
            onStyleChange={(lineStyle) => updateDrawing(symbol, drawing.id, { lineStyle })}
          />
        </div>
        {showFill && (
          <div>
            <p className="mb-1.5 text-xs text-text-muted">填充透明度 ({Math.round(drawing.opacity * 100)}%)</p>
            <input
              type="range" min={0} max={1} step={0.05} value={drawing.opacity}
              onChange={(e) => updateDrawing(symbol, drawing.id, { opacity: parseFloat(e.target.value) })}
              className="w-full accent-gold"
            />
          </div>
        )}
        {showFontSize && (
          <div>
            <p className="mb-1.5 text-xs text-text-muted">文字大小 ({fontSize}px)</p>
            <input
              type="range" min={9} max={28} step={1} value={fontSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setFontSize(v);
                updateDrawing(symbol, drawing.id, { fontSize: v });
              }}
              className="w-full accent-gold"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire double-click into `DrawingLayer.tsx`**

Add state near the other transient state:

```ts
  const [settingsDrawingId, setSettingsDrawingId] = useState<string | null>(null);
```

In `renderShape`'s `hit` object, add an `onDoubleClick` (applies to every branch since they all spread `{...hit}` for their hit-target element, except `text` and `rect`/shape branches which build their own inline handler set — add `onDoubleClick={() => setSettingsDrawingId(d.id)}` to `hit` itself so every `{...hit}` spread picks it up):

```ts
    const hit = {
      stroke: "transparent",
      strokeWidth: 12,
      fill: "none",
      style: { pointerEvents: (activeTool ? "none" : "stroke") as "none" | "stroke", cursor: "move" },
      onPointerDown: (e: ReactPointerEvent<SVGElement>) => onShapePointerDown(e, d),
      onPointerMove: onShapePointerMove,
      onPointerUp: onShapePointerUp,
      onDoubleClick: () => setSettingsDrawingId(d.id),
    };
```

For the branches that don't spread `hit` (the fill-capable shapes: `rect`, `circle`, `triangle`, and the `text` branch, all of which build their own inline `onPointerDown`/`onPointerMove`/`onPointerUp` props), add `onDoubleClick={() => setSettingsDrawingId(d.id)}` next to their existing `onPointerDown` prop in each of those 4 spots.

Import the modal and render it at the bottom of the component, alongside the existing `pendingText` input block:

```ts
import { DrawingSettingsModal } from "./DrawingSettingsModal";
```

```tsx
      {settingsDrawingId && (() => {
        const d = (drawings ?? []).find((dr) => dr.id === settingsDrawingId);
        return d ? (
          <DrawingSettingsModal symbol={symbol} drawing={d} onClose={() => setSettingsDrawingId(null)} />
        ) : null;
      })()}
```

- [ ] **Step 3: Manual verification**

Double-click a trendline: confirm the settings modal opens centered on screen, changing color/width/style updates the line live on the chart behind the modal, closing and reopening shows the just-changed values (not defaults). Repeat for a rectangle (confirm the fill-opacity slider appears) and a text annotation (confirm the font-size slider appears and resizes the label).

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/chart/DrawingSettingsModal.tsx src/components/trade/chart/DrawingLayer.tsx
git commit -m "feat(chart): double-click a drawing to open its style settings modal"
```

---

## Task 10: Indicator style overrides — store + resolver

**Files:**
- Modify: `src/stores/chartStore.ts`
- Modify: `src/lib/chart/indicator-registry.ts`
- Modify: `src/lib/chart/indicator-registry.test.ts`

**Interfaces:**
- Produces: `AppliedIndicator.styleOverrides?: Record<string, Partial<{ color: string; lineWidth: 1|2|3|4; lineStyle: 0|1|2|3|4 }>>`.
- Produces: `useChartStore().updateIndicatorStyle(instanceId: string, plotKey: string, patch: Partial<{ color: string; lineWidth: 1|2|3|4; lineStyle: 0|1|2|3|4 }>) => void`.
- Produces: `resolvePlotStyle(def: IndicatorDef, applied: AppliedIndicator, plotKey: string): { color: string; lineWidth: 1|2|3|4; lineStyle: 0|1|2|3|4 }` in `indicator-registry.ts`, used by Task 11 and Task 12.

Note: `PlotDef.lineStyle` in the registry uses lightweight-charts' numeric `LineStyle` enum (`0` solid, `1` dotted, `2` dashed, `3` large-dashed, `4` sparse-dotted) — `resolvePlotStyle` and `updateIndicatorStyle` use that same numeric type to match, not the drawing tools' `"solid"|"dashed"|"dotted"` string type. `IndicatorModal`'s `LineStyleControl` usage in Task 12 maps between the two.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/chart/indicator-registry.test.ts`:

```ts
import { INDICATORS, INDICATOR_BY_ID, defaultParams, legendLabel, resolvePlotStyle, type IndicatorInput, type AppliedIndicator } from "./indicator-registry";
```

(the existing import line already brings in `INDICATORS, INDICATOR_BY_ID, defaultParams, legendLabel, type IndicatorInput` — extend it with `resolvePlotStyle` and `type AppliedIndicator`; `AppliedIndicator` needs to move from `chartStore.ts` into `indicator-registry.ts` or be duplicated as a type-only shape — simplest: define a minimal local shape in the test instead of importing the store's type, since `indicator-registry.ts` must not import from `chartStore.ts` (`chartStore.ts` already imports from `indicator-registry.ts`, and a reverse import would cycle). Use:)

```ts
import { INDICATORS, INDICATOR_BY_ID, defaultParams, legendLabel, resolvePlotStyle, type IndicatorInput } from "./indicator-registry";
```

```ts
describe("resolvePlotStyle", () => {
  const maDef = INDICATOR_BY_ID.get("ma")!;
  const maPlot = maDef.plots[0];

  it("falls back to the registry's default plot color/width/style when there is no override", () => {
    const resolved = resolvePlotStyle(maDef, undefined, "ma");
    expect(resolved.color).toBe(maPlot.color);
    expect(resolved.lineWidth).toBe(maPlot.lineWidth ?? 1);
    expect(resolved.lineStyle).toBe(maPlot.lineStyle ?? 0);
  });

  it("uses the override's color when one is set for that plot key", () => {
    const resolved = resolvePlotStyle(maDef, { ma: { color: "#ff0000" } }, "ma");
    expect(resolved.color).toBe("#ff0000");
    expect(resolved.lineWidth).toBe(maPlot.lineWidth ?? 1); // unset fields still fall back
  });

  it("returns the registry default for a plot key with no matching override entry", () => {
    const resolved = resolvePlotStyle(maDef, { someOtherKey: { color: "#ff0000" } }, "ma");
    expect(resolved.color).toBe(maPlot.color);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicator-registry`
Expected: FAIL — `resolvePlotStyle` is not exported yet.

- [ ] **Step 3: Implement `resolvePlotStyle` in `indicator-registry.ts`**

Add near the bottom, after `legendLabel`:

```ts
/** A single plot's overridable style fields — mirrors the relevant subset of PlotDef. */
export interface PlotStyleOverride {
  color?: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 0 | 1 | 2 | 3 | 4;
}

/**
 * Resolves a plot's effective color/width/style: the instance's per-plot
 * override when present, falling back to the registry's static default.
 * `overrides` is `AppliedIndicator["styleOverrides"]` — typed loosely here
 * (not imported from chartStore.ts) to avoid a circular import, since
 * chartStore.ts already imports from this module.
 */
export function resolvePlotStyle(
  def: IndicatorDef,
  overrides: Record<string, PlotStyleOverride> | undefined,
  plotKey: string
): { color: string; lineWidth: 1 | 2 | 3 | 4; lineStyle: 0 | 1 | 2 | 3 | 4 } {
  const plot = def.plots.find((p) => p.key === plotKey);
  const override = overrides?.[plotKey];
  return {
    color: override?.color ?? plot?.color ?? "#c9a24b",
    lineWidth: override?.lineWidth ?? plot?.lineWidth ?? 1,
    lineStyle: override?.lineStyle ?? plot?.lineStyle ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicator-registry`
Expected: PASS

- [ ] **Step 5: Add `styleOverrides` and `updateIndicatorStyle` to `chartStore.ts`**

In the `AppliedIndicator` interface:

```ts
export interface AppliedIndicator {
  instanceId: string;
  defId: string;
  params: Record<string, number>;
  visible: boolean;
  styleOverrides?: Record<string, PlotStyleOverride>;
}
```

Add the import:

```ts
import { INDICATOR_BY_ID, defaultParams, type IndicatorDef, type PlotStyleOverride } from "@/lib/chart/indicator-registry";
```

(replacing the existing narrower import line that only brings in `INDICATOR_BY_ID, defaultParams, type IndicatorDef`).

In `ChartState`, add the action signature next to `updateIndicatorParams`:

```ts
  updateIndicatorStyle: (instanceId: string, plotKey: string, patch: PlotStyleOverride) => void;
```

In the store body, add the action next to `updateIndicatorParams`:

```ts
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
```

In `resetIndicatorToDefaults`, also clear `styleOverrides`:

```ts
      resetIndicatorToDefaults: (instanceId) =>
        set((s) => ({
          appliedIndicators: s.appliedIndicators.map((a) => {
            const def = INDICATOR_BY_ID.get(a.defId);
            return a.instanceId === instanceId && def
              ? { ...a, params: defaultParams(def), styleOverrides: undefined }
              : a;
          }),
        })),
```

- [ ] **Step 6: Write a store test for `updateIndicatorStyle`**

Add to `src/stores/chartStore.test.ts`:

```ts
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
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/stores/chartStore.ts src/lib/chart/indicator-registry.ts src/lib/chart/indicator-registry.test.ts
git commit -m "feat(chart): add per-instance indicator plot style overrides"
```

---

## Task 11: `KlineChart` — apply resolved indicator style to series

**Files:**
- Modify: `src/components/trade/KlineChart.tsx`

**Interfaces:**
- Consumes: `resolvePlotStyle` from Task 10.

Manual verification only (rendering wiring, no new pure logic).

- [ ] **Step 1: Import `resolvePlotStyle`**

Add `resolvePlotStyle` to the existing `@/lib/chart/indicator-registry` import in `KlineChart.tsx`.

- [ ] **Step 2: Apply the resolved style in the data-update effect**

In the effect that loops `for (const e of entries)` (the one containing `e.series.applyOptions({ visible });` at the end of each iteration, around line 469), resolve and apply the style right before that line:

```ts
        const resolvedStyle = resolvePlotStyle(def, a.styleOverrides, e.plotKey);
        e.series.applyOptions({
          visible,
          color: resolvedStyle.color,
          ...(plot.kind !== "histogram" && plot.kind !== "dots"
            ? { lineWidth: resolvedStyle.lineWidth, lineStyle: resolvedStyle.lineStyle }
            : {}),
        });
```

Replace the standalone `e.series.applyOptions({ visible });` line with the block above.

For histogram plots, the per-bar `barColor` callback (used for volume's up/down coloring) still takes priority over the resolved color when `plot.barColor` is defined — that's already the existing behavior at the `data.push({ ..., color: plot.barColor ? plot.barColor(...) : plot.color })` line; leave it as `plot.color` there for indicators with a `barColor` function (only `volume` has one), but for histogram indicators *without* `barColor`, use the resolved color instead:

```ts
              color: plot.barColor ? plot.barColor({ i, value: v, input }) : resolvedStyle.color,
```

(This one-line change replaces `plot.color` with `resolvedStyle.color` in the histogram data-building loop — `resolvedStyle` must be computed before that loop starts, so move the `resolvePlotStyle` call to just before the `if (plot.kind === "histogram")` branch rather than after it.)

- [ ] **Step 3: Manual verification**

Apply an MA indicator, open its settings (gear icon — full color UI arrives in Task 12, but `updateIndicatorStyle` can be called from the browser console meanwhile: `useChartStore.getState().updateIndicatorStyle(instanceId, "ma", { color: "#ff0000", lineWidth: 3 })`), confirm the line on the chart turns red and thickens without needing a page reload.

- [ ] **Step 4: Commit**

```bash
git add src/components/trade/KlineChart.tsx
git commit -m "feat(chart): apply resolved per-instance indicator style to series"
```

---

## Task 12: `IndicatorModal` — per-plot color/line-style controls

**Files:**
- Modify: `src/components/trade/chart/IndicatorModal.tsx`

**Interfaces:**
- Consumes: `ColorPicker`, `LineStyleControl` (Task 1), `resolvePlotStyle` (Task 10), `updateIndicatorStyle` (Task 10).

- [ ] **Step 1: Import the new pieces**

```ts
import { ColorPicker } from "./ColorPicker";
import { LineStyleControl, type DrawingLineStyle } from "./LineStyleControl";
```

Extend the existing `indicator-registry` import to include `resolvePlotStyle`, and the `useChartStore` import to include `updateIndicatorStyle`.

- [ ] **Step 2: Add numeric-string LineStyle mapping helpers**

`LineStyleControl` speaks `"solid"|"dashed"|"dotted"`; the registry speaks lightweight-charts' `0|1|2|3|4`. Add near the top of the file:

```ts
const LINE_STYLE_TO_DRAWING: Record<number, DrawingLineStyle> = { 0: "solid", 1: "dotted", 2: "dashed", 3: "dashed", 4: "dotted" };
const DRAWING_TO_LINE_STYLE: Record<DrawingLineStyle, 0 | 1 | 2> = { solid: 0, dotted: 1, dashed: 2 };
```

- [ ] **Step 3: Render one `ColorPicker` + `LineStyleControl` row per plot in the settings panel**

In the `isEditing && (...)` block, after the existing `def.params.map(...)` loop and before the "恢复默认参数" button, add:

```tsx
                        {def.plots.map((plot) => {
                          const resolved = resolvePlotStyle(def, a.styleOverrides, plot.key);
                          return (
                            <div key={plot.key} className="space-y-1">
                              <span className="text-[11px] text-text-secondary">{plot.label ?? plot.key}</span>
                              <ColorPicker
                                value={resolved.color}
                                onChange={(color) => updateIndicatorStyle(a.instanceId, plot.key, { color })}
                              />
                              {plot.kind !== "histogram" && plot.kind !== "dots" && (
                                <LineStyleControl
                                  width={resolved.lineWidth}
                                  style={LINE_STYLE_TO_DRAWING[resolved.lineStyle]}
                                  onWidthChange={(lineWidth) => updateIndicatorStyle(a.instanceId, plot.key, { lineWidth })}
                                  onStyleChange={(s) => updateIndicatorStyle(a.instanceId, plot.key, { lineStyle: DRAWING_TO_LINE_STYLE[s] })}
                                />
                              )}
                            </div>
                          );
                        })}
```

Add the `updateIndicatorStyle` store hook next to the other action hooks at the top of the component:

```ts
  const updateIndicatorStyle = useChartStore((s) => s.updateIndicatorStyle);
```

- [ ] **Step 4: Manual verification**

Apply a multi-plot indicator (e.g. Bollinger Bands — 3 plots: upper/middle/lower). Open its settings panel, confirm 3 color pickers and 3 line-style controls appear, each labeled with its plot name, each independently changes that one line's appearance on the chart. Click "恢复默认参数" and confirm all 3 plots revert to their registry default colors.

- [ ] **Step 5: Commit**

```bash
git add src/components/trade/chart/IndicatorModal.tsx
git commit -m "feat(chart): add per-plot color and line-style controls to indicator settings"
```

---

## Task 13: New indicator — KDJ

**Files:**
- Create: `src/lib/indicators.test.ts`
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeKDJ(highs: number[], lows: number[], closes: number[], period?: number, kSmooth?: number, dSmooth?: number): { k: (number|null)[]; d: (number|null)[]; j: (number|null)[] }`.
- Produces: registry entry `id: "kdj"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/indicators.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeKDJ } from "./indicators";

describe("computeKDJ", () => {
  const highs = [10, 11, 12, 11, 10, 9, 10, 11, 12, 13, 12, 11];
  const lows = [8, 9, 10, 9, 8, 7, 8, 9, 10, 11, 10, 9];
  const closes = [9, 10, 11, 10, 9, 8, 9, 10, 11, 12, 11, 10];

  it("returns null for k/d/j before the warm-up period completes", () => {
    const { k, d, j } = computeKDJ(highs, lows, closes, 9, 3, 3);
    expect(k[7]).toBeNull();
    expect(d[7]).toBeNull();
    expect(j[7]).toBeNull();
  });

  it("produces a finite K value once `period` bars are available", () => {
    const { k } = computeKDJ(highs, lows, closes, 9, 3, 3);
    expect(k[8]).not.toBeNull();
    expect(Number.isFinite(k[8])).toBe(true);
  });

  it("computes J as 3K - 2D once both are available", () => {
    const { k, d, j } = computeKDJ(highs, lows, closes, 9, 3, 3);
    const lastIdx = closes.length - 1;
    if (k[lastIdx] !== null && d[lastIdx] !== null) {
      expect(j[lastIdx]).toBeCloseTo(3 * k[lastIdx]! - 2 * d[lastIdx]!, 6);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL — `computeKDJ` is not exported from `./indicators` yet.

- [ ] **Step 3: Implement `computeKDJ` in `src/lib/indicators.ts`**

Append at the end of the file:

```ts
/**
 * KDJ — the RSV-based oscillator most common on Chinese exchanges. Like
 * Stochastic but K/D are smoothed with a recursive 1/3 weight (not a plain
 * SMA), and J = 3K - 2D exaggerates divergence between K and D.
 */
export function computeKDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 9,
  kSmooth = 3,
  dSmooth = 3
): { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] } {
  const n = closes.length;
  const k: (number | null)[] = new Array(n).fill(null);
  const d: (number | null)[] = new Array(n).fill(null);
  const j: (number | null)[] = new Array(n).fill(null);
  if (n < period) return { k, d, j };

  let prevK = 50;
  let prevD = 50;
  for (let i = period - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let x = i - period + 1; x <= i; x++) {
      if (highs[x] > highest) highest = highs[x];
      if (lows[x] < lowest) lowest = lows[x];
    }
    const range = highest - lowest;
    const rsv = range === 0 ? 50 : ((closes[i] - lowest) / range) * 100;
    const kVal = ((kSmooth - 1) * prevK + rsv) / kSmooth;
    const dVal = ((dSmooth - 1) * prevD + kVal) / dSmooth;
    k[i] = kVal;
    d[i] = dVal;
    j[i] = 3 * kVal - 2 * dVal;
    prevK = kVal;
    prevD = dVal;
  }
  return { k, d, j };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

In `src/lib/chart/indicator-registry.ts`, add `computeKDJ` to the import from `@/lib/indicators`, and add an entry in the momentum section (near `stoch`):

```ts
  {
    id: "kdj", name: "KDJ 随机指标", short: "KDJ", category: "momentum", placement: "pane",
    params: [
      p1("period", "周期", 9),
      { key: "kSmooth", label: "K 平滑", default: 3, min: 1, max: 20, step: 1 },
      { key: "dSmooth", label: "D 平滑", default: 3, min: 1, max: 20, step: 1 },
    ],
    plots: [
      { key: "k", label: "K", color: C.blue },
      { key: "d", label: "D", color: C.amber },
      { key: "j", label: "J", color: C.purple },
    ],
    compute: (i, p) => {
      const r = computeKDJ(i.high, i.low, i.close, p.period, p.kSmooth, p.dSmooth);
      return { k: r.k, d: r.d, j: r.j };
    },
    guides: [20, 80],
  },
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass, including the existing generic registry-integrity tests (unique id, ≥1 plot, unique plot keys, params within min/max) — no new test needed for those since they iterate over every entry in `INDICATORS` automatically.

- [ ] **Step 7: Commit**

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add KDJ indicator"
```

---

## Task 14: New indicator — Stochastic RSI

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeStochRSI(closes: number[], rsiPeriod?: number, stochPeriod?: number, kSmooth?: number, dSmooth?: number): { k: (number|null)[]; d: (number|null)[] }`.
- Produces: registry entry `id: "stochrsi"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeStochRSI } from "./indicators";

describe("computeStochRSI", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);

  it("stays null until rsiPeriod + stochPeriod bars have accumulated", () => {
    const { k } = computeStochRSI(closes, 14, 14, 3, 3);
    expect(k[20]).toBeNull();
  });

  it("produces K values within [0, 100] once warmed up", () => {
    const { k, d } = computeStochRSI(closes, 14, 14, 3, 3);
    for (let i = 30; i < closes.length; i++) {
      if (k[i] !== null) {
        expect(k[i]!).toBeGreaterThanOrEqual(0);
        expect(k[i]!).toBeLessThanOrEqual(100);
      }
      if (d[i] !== null) {
        expect(d[i]!).toBeGreaterThanOrEqual(0);
        expect(d[i]!).toBeLessThanOrEqual(100);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL — `computeStochRSI` not exported yet.

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts` (reuses the existing `computeRSI` in this same file). Note: `computeMA` sums raw numbers and can't skip `null`s, so the K/D smoothing pass below uses its own null-safe loop instead of calling `computeMA` on `null`-padded warm-up data (matching the pattern `computeStochastic`'s `%D` already uses elsewhere in this file):

```ts
export function computeStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const n = closes.length;
  const rsi = computeRSI(closes, rsiPeriod);
  const rawK: (number | null)[] = new Array(n).fill(null);
  for (let i = rsiPeriod + stochPeriod - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    let complete = true;
    for (let x = i - stochPeriod + 1; x <= i; x++) {
      const v = rsi[x];
      if (v === null) { complete = false; break; }
      if (v > highest) highest = v;
      if (v < lowest) lowest = v;
    }
    if (!complete) continue;
    const range = highest - lowest;
    rawK[i] = range === 0 ? 0 : ((rsi[i]! - lowest) / range) * 100;
  }
  const smooth = (src: (number | null)[], period: number): (number | null)[] => {
    const out: (number | null)[] = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      let sum = 0;
      let complete = true;
      for (let x = i - period + 1; x <= i; x++) {
        const v = src[x];
        if (v === null) { complete = false; break; }
        sum += v;
      }
      if (complete) out[i] = sum / period;
    }
    return out;
  };
  const k = smooth(rawK, kSmooth);
  const d = smooth(k, dSmooth);
  return { k, d };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeStochRSI` to the `@/lib/indicators` import in `indicator-registry.ts`, and add near `stoch`:

```ts
  {
    id: "stochrsi", name: "随机 RSI Stochastic RSI", short: "StochRSI", category: "momentum", placement: "pane",
    params: [
      p1("rsiPeriod", "RSI 周期", 14),
      p1("stochPeriod", "随机周期", 14),
      { key: "kSmooth", label: "K 平滑", default: 3, min: 1, max: 20, step: 1 },
      { key: "dSmooth", label: "D 平滑", default: 3, min: 1, max: 20, step: 1 },
    ],
    plots: [
      { key: "k", label: "%K", color: C.blue },
      { key: "d", label: "%D", color: C.amber },
    ],
    compute: (i, p) => {
      const r = computeStochRSI(i.close, p.rsiPeriod, p.stochPeriod, p.kSmooth, p.dSmooth);
      return { k: r.k, d: r.d };
    },
    guides: [20, 80],
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Stochastic RSI indicator"
```

---

## Task 15: New indicator — Awesome Oscillator

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeAwesomeOscillator(highs: number[], lows: number[], fastPeriod?: number, slowPeriod?: number): (number|null)[]`.
- Produces: registry entry `id: "ao"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeAwesomeOscillator } from "./indicators";

describe("computeAwesomeOscillator", () => {
  const highs = Array.from({ length: 50 }, (_, i) => 105 + Math.sin(i / 4) * 8 + i * 0.1);
  const lows = Array.from({ length: 50 }, (_, i) => 95 + Math.sin(i / 4) * 8 + i * 0.1);

  it("stays null before slowPeriod bars have accumulated", () => {
    const ao = computeAwesomeOscillator(highs, lows, 5, 34);
    expect(ao[10]).toBeNull();
  });

  it("produces a finite value once slowPeriod bars are available", () => {
    const ao = computeAwesomeOscillator(highs, lows, 5, 34);
    expect(ao[40]).not.toBeNull();
    expect(Number.isFinite(ao[40])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts`:

```ts
/** Awesome Oscillator — SMA(5) minus SMA(34) of the median price (high+low)/2. */
export function computeAwesomeOscillator(
  highs: number[],
  lows: number[],
  fastPeriod = 5,
  slowPeriod = 34
): (number | null)[] {
  const median = highs.map((h, i) => (h + lows[i]) / 2);
  const fast = computeMA(median, fastPeriod);
  const slow = computeMA(median, slowPeriod);
  return fast.map((f, i) => (f === null || slow[i] === null ? null : f - slow[i]!));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeAwesomeOscillator` to the import, and add near `momentum`:

```ts
  {
    id: "ao", name: "动量振荡指标 Awesome Oscillator", short: "AO", category: "momentum", placement: "pane",
    params: [
      p1("fastPeriod", "快周期", 5),
      p1("slowPeriod", "慢周期", 34),
    ],
    plots: [
      {
        key: "ao", label: "AO", color: C.up, kind: "histogram",
        barColor: ({ i, value, input }) => {
          const prevMedian = i > 0 ? (input.high[i - 1] + input.low[i - 1]) / 2 : (input.high[i] + input.low[i]) / 2;
          const median = (input.high[i] + input.low[i]) / 2;
          void value;
          return median >= prevMedian ? C.up : C.down;
        },
      },
    ],
    compute: (i, p) => ({ ao: computeAwesomeOscillator(i.high, i.low, p.fastPeriod, p.slowPeriod) }),
    guides: [0],
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Awesome Oscillator indicator"
```

---

## Task 16: New indicator — Hull Moving Average

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeHullMA(closes: number[], period?: number): (number|null)[]`.
- Produces: registry entry `id: "hma"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeHullMA } from "./indicators";

describe("computeHullMA", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);

  it("stays null before enough bars for the full WMA(sqrt(period)) chain", () => {
    const hma = computeHullMA(closes, 9);
    expect(hma[2]).toBeNull();
  });

  it("tracks a steadily rising series with a rising value", () => {
    const hma = computeHullMA(closes, 9);
    const last = hma[closes.length - 1];
    const prior = hma[closes.length - 5];
    expect(last).not.toBeNull();
    expect(prior).not.toBeNull();
    expect(last!).toBeGreaterThan(prior!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts` (reuses `computeWMA`, already defined in this file):

```ts
/** Hull Moving Average — WMA(2*WMA(n/2) - WMA(n), sqrt(n)); faster to turn than a plain EMA. */
export function computeHullMA(closes: number[], period = 9): (number | null)[] {
  const halfPeriod = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = computeWMA(closes, halfPeriod);
  const wmaFull = computeWMA(closes, period);
  const diff = closes.map((_, i) =>
    wmaHalf[i] === null || wmaFull[i] === null ? null : 2 * wmaHalf[i]! - wmaFull[i]!
  );
  // WMA over `diff` needs its own null-safe pass since computeWMA assumes a plain number[].
  const result: (number | null)[] = new Array(closes.length).fill(null);
  const denom = (sqrtPeriod * (sqrtPeriod + 1)) / 2;
  for (let i = sqrtPeriod - 1; i < diff.length; i++) {
    let weighted = 0;
    let complete = true;
    for (let x = 0; x < sqrtPeriod; x++) {
      const v = diff[i - x];
      if (v === null) { complete = false; break; }
      weighted += v * (sqrtPeriod - x);
    }
    if (complete) result[i] = weighted / denom;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeHullMA` to the import, and add near `ma`/`ema`:

```ts
  {
    id: "hma", name: "赫尔均线 Hull MA", short: "HMA", category: "trend", placement: "main",
    params: [p1("period", "周期", 9)],
    plots: [{ key: "hma", color: C.fuchsia }],
    compute: (i, p) => ({ hma: computeHullMA(i.close, p.period) }),
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Hull Moving Average indicator"
```

---

## Task 17: New indicator — Williams Alligator

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeAlligator(highs: number[], lows: number[], jawPeriod?: number, jawShift?: number, teethPeriod?: number, teethShift?: number, lipsPeriod?: number, lipsShift?: number): { jaw: (number|null)[]; teeth: (number|null)[]; lips: (number|null)[] }`.
- Produces: registry entry `id: "alligator"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeAlligator } from "./indicators";

describe("computeAlligator", () => {
  const highs = Array.from({ length: 60 }, (_, i) => 105 + Math.sin(i / 6) * 5 + i * 0.1);
  const lows = Array.from({ length: 60 }, (_, i) => 95 + Math.sin(i / 6) * 5 + i * 0.1);

  it("shifts each line forward by its own shift amount (nulls at the start)", () => {
    const { jaw, lips } = computeAlligator(highs, lows, 13, 8, 8, 5, 5, 3);
    // lips (shift 3) should have a value strictly before jaw (shift 8) does
    const firstLipsIdx = lips.findIndex((v) => v !== null);
    const firstJawIdx = jaw.findIndex((v) => v !== null);
    expect(firstLipsIdx).toBeGreaterThan(-1);
    expect(firstJawIdx).toBeGreaterThan(-1);
    expect(firstLipsIdx).toBeLessThan(firstJawIdx);
  });

  it("produces finite values once all three lines are warmed up", () => {
    const { jaw, teeth, lips } = computeAlligator(highs, lows, 13, 8, 8, 5, 5, 3);
    const lastIdx = highs.length - 1;
    expect(jaw[lastIdx]).not.toBeNull();
    expect(teeth[lastIdx]).not.toBeNull();
    expect(lips[lastIdx]).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts`:

```ts
/**
 * Williams Alligator — three SMMA (Wilder-smoothed) lines of the median
 * price, each displaced forward in time by its own `shift`. Jaw (slowest,
 * blue) = SMMA(13) shifted 8; Teeth (medium, red) = SMMA(8) shifted 5;
 * Lips (fastest, green) = SMMA(5) shifted 3, in the traditional parameters.
 */
export function computeAlligator(
  highs: number[],
  lows: number[],
  jawPeriod = 13,
  jawShift = 8,
  teethPeriod = 8,
  teethShift = 5,
  lipsPeriod = 5,
  lipsShift = 3
): { jaw: (number | null)[]; teeth: (number | null)[]; lips: (number | null)[] } {
  const n = highs.length;
  const median = highs.map((h, i) => (h + lows[i]) / 2);

  const smma = (src: number[], period: number): (number | null)[] => {
    const out: (number | null)[] = new Array(src.length).fill(null);
    if (src.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += src[i];
    let prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < src.length; i++) {
      prev = (prev * (period - 1) + src[i]) / period;
      out[i] = prev;
    }
    return out;
  };

  const shift = (src: (number | null)[], amount: number): (number | null)[] => {
    const out: (number | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const from = i - amount;
      if (from >= 0 && from < src.length) out[i] = src[from];
    }
    return out;
  };

  return {
    jaw: shift(smma(median, jawPeriod), jawShift),
    teeth: shift(smma(median, teethPeriod), teethShift),
    lips: shift(smma(median, lipsPeriod), lipsShift),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeAlligator` to the import, and add near `ichimoku`:

```ts
  {
    id: "alligator", name: "鳄鱼线 Williams Alligator", short: "Alligator", category: "trend", placement: "main",
    params: [
      p1("jawPeriod", "颚线周期", 13), p1("jawShift", "颚线位移", 8),
      p1("teethPeriod", "齿线周期", 8), p1("teethShift", "齿线位移", 5),
      p1("lipsPeriod", "唇线周期", 5), p1("lipsShift", "唇线位移", 3),
    ],
    plots: [
      { key: "jaw", label: "颚线 Jaw", color: C.blue },
      { key: "teeth", label: "齿线 Teeth", color: C.rose },
      { key: "lips", label: "唇线 Lips", color: C.green },
    ],
    compute: (i, p) => {
      const r = computeAlligator(i.high, i.low, p.jawPeriod, p.jawShift, p.teethPeriod, p.teethShift, p.lipsPeriod, p.lipsShift);
      return { jaw: r.jaw, teeth: r.teeth, lips: r.lips };
    },
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Williams Alligator indicator"
```

---

## Task 18: New indicator — Pivot Points (Standard)

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computePivotPoints(highs: number[], lows: number[], closes: number[]): { pivot: (number|null)[]; r1: (number|null)[]; s1: (number|null)[]; r2: (number|null)[]; s2: (number|null)[] }`.
- Produces: registry entry `id: "pivots"`.

Note: real "Standard" pivot points are computed once per higher timeframe (e.g. daily pivots shown on an hourly chart) — that needs cross-timeframe data this codebase's per-bar `IndicatorInput` doesn't have. This implementation uses the previous bar's H/L/C on whatever interval is currently displayed (a documented simplification, called out in the code comment), giving a rolling per-bar pivot instead of a fixed daily one.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computePivotPoints } from "./indicators";

describe("computePivotPoints", () => {
  const highs = [12, 13, 14, 13];
  const lows = [8, 9, 10, 9];
  const closes = [10, 11, 12, 11];

  it("has no pivot for the first bar (no prior bar to derive it from)", () => {
    const { pivot } = computePivotPoints(highs, lows, closes);
    expect(pivot[0]).toBeNull();
  });

  it("computes pivot = (prevHigh + prevLow + prevClose) / 3", () => {
    const { pivot } = computePivotPoints(highs, lows, closes);
    expect(pivot[1]).toBeCloseTo((12 + 8 + 10) / 3, 6);
  });

  it("computes R1/S1 symmetric around the pivot using the prior range", () => {
    const { pivot, r1, s1 } = computePivotPoints(highs, lows, closes);
    const p = pivot[1]!;
    expect(r1[1]).toBeCloseTo(2 * p - lows[0], 6);
    expect(s1[1]).toBeCloseTo(2 * p - highs[0], 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts`:

```ts
/**
 * Standard Pivot Points, computed per-bar from the *previous* bar's H/L/C
 * (a rolling simplification — real "Standard" pivots use a fixed higher
 * timeframe like daily, which this per-bar compute function doesn't have
 * access to). P = (H+L+C)/3; R1/S1 and R2/S2 follow the standard formulas.
 */
export function computePivotPoints(
  highs: number[],
  lows: number[],
  closes: number[]
): {
  pivot: (number | null)[];
  r1: (number | null)[];
  s1: (number | null)[];
  r2: (number | null)[];
  s2: (number | null)[];
} {
  const n = closes.length;
  const pivot: (number | null)[] = new Array(n).fill(null);
  const r1: (number | null)[] = new Array(n).fill(null);
  const s1: (number | null)[] = new Array(n).fill(null);
  const r2: (number | null)[] = new Array(n).fill(null);
  const s2: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const ph = highs[i - 1];
    const pl = lows[i - 1];
    const pc = closes[i - 1];
    const p = (ph + pl + pc) / 3;
    pivot[i] = p;
    r1[i] = 2 * p - pl;
    s1[i] = 2 * p - ph;
    r2[i] = p + (ph - pl);
    s2[i] = p - (ph - pl);
  }
  return { pivot, r1, s1, r2, s2 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computePivotPoints` to the import, and add near `donchian`:

```ts
  {
    id: "pivots", name: "枢轴点 Pivot Points", short: "Pivots", category: "trend", placement: "main",
    params: [],
    plots: [
      { key: "pivot", label: "P", color: C.yellow },
      { key: "r1", label: "R1", color: C.down },
      { key: "s1", label: "S1", color: C.up },
      { key: "r2", label: "R2", color: C.down, lineStyle: 1 },
      { key: "s2", label: "S2", color: C.up, lineStyle: 1 },
    ],
    compute: (i) => {
      const r = computePivotPoints(i.high, i.low, i.close);
      return { pivot: r.pivot, r1: r.r1, s1: r.s1, r2: r.r2, s2: r.s2 };
    },
    legendParams: () => "",
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Pivot Points (Standard) indicator"
```

---

## Task 19: New indicator — Chaikin Oscillator

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeChaikinOscillator(highs: number[], lows: number[], closes: number[], volumes: number[], fastPeriod?: number, slowPeriod?: number): (number|null)[]`.
- Produces: registry entry `id: "chaikinosc"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeChaikinOscillator } from "./indicators";

describe("computeChaikinOscillator", () => {
  const n = 40;
  const highs = Array.from({ length: n }, (_, i) => 105 + i * 0.3);
  const lows = Array.from({ length: n }, (_, i) => 95 + i * 0.3);
  const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.3 + (i % 2 === 0 ? 2 : -2));
  const volumes = Array.from({ length: n }, () => 1000);

  it("stays null before slowPeriod bars have accumulated", () => {
    const osc = computeChaikinOscillator(highs, lows, closes, volumes, 3, 10);
    expect(osc[2]).toBeNull();
  });

  it("produces a finite value once warmed up", () => {
    const osc = computeChaikinOscillator(highs, lows, closes, volumes, 3, 10);
    expect(osc[n - 1]).not.toBeNull();
    expect(Number.isFinite(osc[n - 1])).toBe(true);
  });

  it("handles a zero high-low range bar without producing NaN (division guard)", () => {
    const flatHighs = [...highs]; flatHighs[5] = lows[5]; // high === low on bar 5
    const osc = computeChaikinOscillator(flatHighs, lows, closes, volumes, 3, 10);
    for (const v of osc) expect(Number.isNaN(v as number)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts`:

```ts
/** Chaikin Oscillator — EMA(fast) minus EMA(slow) of the Accumulation/Distribution Line. */
export function computeChaikinOscillator(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  fastPeriod = 3,
  slowPeriod = 10
): (number | null)[] {
  const n = closes.length;
  const adl: number[] = new Array(n).fill(0);
  let running = 0;
  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i];
    const moneyFlowMultiplier = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    running += moneyFlowMultiplier * volumes[i];
    adl[i] = running;
  }
  const emaFast = computeEMA(adl, fastPeriod);
  const emaSlow = computeEMA(adl, slowPeriod);
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = slowPeriod - 1; i < n; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) out[i] = emaFast[i]! - emaSlow[i]!;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeChaikinOscillator` to the import, and add near `cmf`/`obv` in the volume section:

```ts
  {
    id: "chaikinosc", name: "佳庆振荡器 Chaikin Oscillator", short: "ChaikinOsc", category: "volume", placement: "pane",
    params: [p1("fastPeriod", "快周期", 3), p1("slowPeriod", "慢周期", 10)],
    plots: [{ key: "chaikinosc", color: C.indigo }],
    compute: (i, p) => ({ chaikinosc: computeChaikinOscillator(i.high, i.low, i.close, i.volume, p.fastPeriod, p.slowPeriod) }),
    guides: [0],
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Chaikin Oscillator indicator"
```

---

## Task 20: New indicator — Vortex Indicator

**Files:**
- Modify: `src/lib/indicators.ts`
- Modify: `src/lib/indicators.test.ts`
- Modify: `src/lib/chart/indicator-registry.ts`

**Interfaces:**
- Produces: `computeVortex(highs: number[], lows: number[], closes: number[], period?: number): { viPlus: (number|null)[]; viMinus: (number|null)[] }`.
- Produces: registry entry `id: "vortex"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/indicators.test.ts`:

```ts
import { computeVortex } from "./indicators";

describe("computeVortex", () => {
  const n = 40;
  const highs = Array.from({ length: n }, (_, i) => 105 + Math.sin(i / 5) * 4 + i * 0.15);
  const lows = Array.from({ length: n }, (_, i) => 95 + Math.sin(i / 5) * 4 + i * 0.15);
  const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 5) * 4 + i * 0.15);

  it("stays null before period bars have accumulated", () => {
    const { viPlus, viMinus } = computeVortex(highs, lows, closes, 14);
    expect(viPlus[5]).toBeNull();
    expect(viMinus[5]).toBeNull();
  });

  it("produces positive finite values once warmed up (VI+/VI- are always >= 0)", () => {
    const { viPlus, viMinus } = computeVortex(highs, lows, closes, 14);
    for (let i = 20; i < n; i++) {
      expect(viPlus[i]).not.toBeNull();
      expect(viPlus[i]!).toBeGreaterThanOrEqual(0);
      expect(viMinus[i]!).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- indicators`
Expected: FAIL

- [ ] **Step 3: Implement**

Append to `src/lib/indicators.ts`:

```ts
/** Vortex Indicator — VI+/VI- compare directional price movement against true range over `period` bars. */
export function computeVortex(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): { viPlus: (number | null)[]; viMinus: (number | null)[] } {
  const n = closes.length;
  const vmPlus: number[] = new Array(n).fill(0);
  const vmMinus: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    vmPlus[i] = Math.abs(highs[i] - lows[i - 1]);
    vmMinus[i] = Math.abs(lows[i] - highs[i - 1]);
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const viPlus: (number | null)[] = new Array(n).fill(null);
  const viMinus: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let sumVmPlus = 0, sumVmMinus = 0, sumTr = 0;
    for (let x = i - period + 1; x <= i; x++) {
      sumVmPlus += vmPlus[x];
      sumVmMinus += vmMinus[x];
      sumTr += tr[x];
    }
    viPlus[i] = sumTr === 0 ? 0 : sumVmPlus / sumTr;
    viMinus[i] = sumTr === 0 ? 0 : sumVmMinus / sumTr;
  }
  return { viPlus, viMinus };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- indicators`
Expected: PASS

- [ ] **Step 5: Add the registry entry**

Add `computeVortex` to the import, and add near `adx`/`aroon`:

```ts
  {
    id: "vortex", name: "涡旋指标 Vortex Indicator", short: "Vortex", category: "trend", placement: "pane",
    params: [p1("period", "周期", 14)],
    plots: [
      { key: "viPlus", label: "VI+", color: C.up },
      { key: "viMinus", label: "VI-", color: C.down },
    ],
    compute: (i, p) => {
      const r = computeVortex(i.high, i.low, i.close, p.period);
      return { viPlus: r.viPlus, viMinus: r.viMinus };
    },
    guides: [1],
  },
```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — expect all pass.

```bash
git add src/lib/indicators.ts src/lib/indicators.test.ts src/lib/chart/indicator-registry.ts
git commit -m "feat(chart): add Vortex Indicator"
```

---

## Final Verification

After all 20 tasks:

- [ ] Run `npx tsc --noEmit` — expect no errors.
- [ ] Run `npm test` — expect all tests pass (existing + all new ones added across these tasks).
- [ ] In the browser (Pro test account), open `/trade`, open the indicator picker: confirm all 38 indicators are listed and searchable, and the 8 new ones (KDJ, Stochastic RSI, Awesome Oscillator, Hull MA, Williams Alligator, Pivot Points, Chaikin Oscillator, Vortex) can be applied and show sensible values.
- [ ] In the drawing toolbar: confirm all 15 tools can be drawn, double-clicking any drawing opens its settings modal, and color/width/style/opacity/font-size changes are visible immediately and persist across a page reload (localStorage).
- [ ] Confirm no existing drawing or indicator's default appearance changed (spot-check a MA, an RSI, and a trendline drawn before this work, if any test data/screenshots from earlier in this session are available for comparison).
