import { describe, it, expect, vi } from "vitest";
import { translateBriefingJson } from "./translate-json";
import type { BriefingJson } from "./types";

const ZH: BriefingJson = {
  title: "早报 | 8月8日 比特币小幅上行",
  summary: "过去二十四小时加密市场温和上行，黄金延续强势。",
  headlines: [
    { topic: "加密货币", points: ["比特币震荡", "以太坊走高"] },
    { topic: "黄金", points: ["黄金代币续创新高"] },
  ],
  analysis: {
    overview: "整体偏暖。",
    crypto: "BTC 报 $64,959.52，上涨 0.92%。",
    gold: "XAUT 报 $4,325.51。",
    watchlist: ["关注美联储", "关注黄金"],
  },
};

/** 字段数 = title + summary + (2 topic + 3 point) + 3 analysis + 2 watchlist */
const FIELD_COUNT = 12;

/** 打桩成一个把中文换成 ASCII 的翻译器，好让语种自检真的能过 */
function asciiTranslator() {
  return vi.fn(async (text: string) => `EN<${text.replace(/[^\x20-\x7e]/g, "x")}>`);
}

describe("translateBriefingJson", () => {
  it("逐字段翻译而不是整篇 HTML——字段数与结构完全保持", async () => {
    const translate = asciiTranslator();
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(translate).toHaveBeenCalledTimes(FIELD_COUNT);
    expect(out).not.toBeNull();
    expect(out!.headlines).toHaveLength(2);
    expect(out!.headlines[0].points).toHaveLength(2);
    expect(out!.headlines[1].points).toHaveLength(1);
    expect(out!.analysis.watchlist).toHaveLength(2);
  });

  it("字段按原顺序对号入座，不会串位", async () => {
    const translate = vi.fn(async (text: string) => `[${text}]`);
    const out = await translateBriefingJson(ZH, "zh", "en", "zh-CN", translate);
    expect(out!.title).toBe(`[${ZH.title}]`);
    expect(out!.summary).toBe(`[${ZH.summary}]`);
    expect(out!.headlines[0].topic).toBe("[加密货币]");
    expect(out!.headlines[0].points).toEqual(["[比特币震荡]", "[以太坊走高]"]);
    expect(out!.headlines[1].topic).toBe("[黄金]");
    expect(out!.headlines[1].points).toEqual(["[黄金代币续创新高]"]);
    expect(out!.analysis.overview).toBe("[整体偏暖。]");
    expect(out!.analysis.crypto).toBe("[BTC 报 $64,959.52，上涨 0.92%。]");
    expect(out!.analysis.gold).toBe("[XAUT 报 $4,325.51。]");
    expect(out!.analysis.watchlist).toEqual(["[关注美联储]", "[关注黄金]"]);
  });

  // C3 的底线：任何一个字段失败都不能悄悄发布另一种语言的正文
  it("任一字段返回 null 就整体返回 null", async () => {
    const translate = vi.fn(async (text: string) =>
      text === ZH.analysis.gold ? null : `EN ${text.length}`
    );
    expect(await translateBriefingJson(ZH, "zh", "en", "en-US", translate)).toBeNull();
  });

  it("返回空串同样视为失败", async () => {
    const translate = vi.fn(async (text: string) => (text === ZH.title ? "   " : `EN ${text.length}`));
    expect(await translateBriefingJson(ZH, "zh", "en", "en-US", translate)).toBeNull();
  });

  // 免费翻译端点限流时会软失败、原样吐回输入
  it("翻译器原样吐回中文时，en-US 目标判定失败（正文回退链要求 en-US 真的是英文）", async () => {
    const translate = vi.fn(async (text: string) => text);
    expect(await translateBriefingJson(ZH, "zh", "en", "en-US", translate)).toBeNull();
  });

  it("反向：译成中文却全是英文，同样判定失败", async () => {
    const translate = asciiTranslator();
    expect(await translateBriefingJson(ZH, "zh", "zh", "zh-CN", translate)).toBeNull();
  });

  it("单个字段的体积远低于任何 URL 上限（整篇 HTML 正是撞在这里）", async () => {
    const seen: string[] = [];
    const translate = vi.fn(async (text: string) => {
      seen.push(text);
      return `EN ${text.length}`;
    });
    await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    // 质量门槛把 analysis 每段限死在 600 字以内；中文经 encodeURIComponent
    // 约膨胀 9 倍，600 字 ≈ 5.4KB，仍在经典 8KB 请求行上限内
    for (const text of seen) {
      expect(encodeURIComponent(text).length).toBeLessThan(8_000);
    }
  });
});
