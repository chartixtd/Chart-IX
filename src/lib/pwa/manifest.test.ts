import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest";

const copy = {
  name: "Chart-IX — 加密货币交易教育与实盘平台",
  shortName: "Chart-IX",
  description: "从零开始学习加密货币交易，再连接 BingX 实盘下单。",
  tradeShortcut: "交易",
  screenerShortcut: "选币",
};

describe("buildManifest", () => {
  it("三种语言必须共用同一个 id，否则会被浏览器当成三个应用", () => {
    const ids = ["zh-CN", "en-US", "ms-MY"].map((l) => buildManifest(l, copy).id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("/");
  });

  it("start_url 指向该语言的仪表盘并带上启动来源标记", () => {
    expect(buildManifest("ms-MY", copy).start_url).toBe("/ms-MY/dashboard?source=pwa");
  });

  it("scope 覆盖整站", () => {
    expect(buildManifest("en-US", copy).scope).toBe("/");
  });

  it("使用 standalone 而非 fullscreen——盯盘的人需要看到状态栏", () => {
    const m = buildManifest("zh-CN", copy);
    expect(m.display).toBe("standalone");
    expect(m.display_override).toEqual(["standalone", "minimal-ui"]);
  });

  it("不锁定屏幕方向——K 线图横屏更好用", () => {
    expect(buildManifest("zh-CN", copy)).not.toHaveProperty("orientation");
  });

  it("同时提供普通图标与 maskable 图标", () => {
    const purposes = buildManifest("zh-CN", copy).icons.map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("图标尺寸覆盖 192 与 512", () => {
    const sizes = buildManifest("zh-CN", copy).icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("配色沿用设计令牌", () => {
    const m = buildManifest("zh-CN", copy);
    expect(m.theme_color).toBe("#0B0A08");
    expect(m.background_color).toBe("#0B0A08");
  });

  it("快捷方式的链接带上对应语言前缀", () => {
    const m = buildManifest("ms-MY", copy);
    expect(m.shortcuts.map((s) => s.url)).toEqual(["/ms-MY/trade", "/ms-MY/screener"]);
  });

  it("文案来自传入的 copy，不写死语言", () => {
    const m = buildManifest("ms-MY", copy);
    expect(m.name).toBe(copy.name);
    expect(m.short_name).toBe(copy.shortName);
    expect(m.description).toBe(copy.description);
  });
});
