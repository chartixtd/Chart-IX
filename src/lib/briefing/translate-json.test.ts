import { describe, it, expect, vi } from "vitest";
import { translateBriefingJson } from "./translate-json";
import type { TranslateResult } from "@/lib/translate";
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

const okText = (text: string): TranslateResult => ({ ok: true, text });
const failed = (reason: string): TranslateResult => ({ ok: false, reason });

/** 打桩成一个把中文换成 ASCII 的翻译器，好让语种自检真的能过 */
function asciiTranslator() {
  return vi.fn(async (text: string) => okText(`EN<${text.replace(/[^\x20-\x7e]/g, "x")}>`));
}

/** 断言成功并取出译稿——失败时把 reason 打进断言消息，排查不用再猜 */
function expectOk(out: Awaited<ReturnType<typeof translateBriefingJson>>): BriefingJson {
  if (!out.ok) throw new Error(`预期翻译成功，实际失败: ${out.reason}`);
  return out.json;
}

describe("translateBriefingJson", () => {
  it("逐字段翻译而不是整篇 HTML——字段数与结构完全保持", async () => {
    const translate = asciiTranslator();
    const json = expectOk(await translateBriefingJson(ZH, "zh", "en", "en-US", translate));
    expect(translate).toHaveBeenCalledTimes(FIELD_COUNT);
    expect(json.headlines).toHaveLength(2);
    expect(json.headlines[0].points).toHaveLength(2);
    expect(json.headlines[1].points).toHaveLength(1);
    expect(json.analysis.watchlist).toHaveLength(2);
  });

  it("字段按原顺序对号入座，不会串位", async () => {
    const translate = vi.fn(async (text: string) => okText(`[${text}]`));
    const json = expectOk(await translateBriefingJson(ZH, "zh", "en", "zh-CN", translate));
    expect(json.title).toBe(`[${ZH.title}]`);
    expect(json.summary).toBe(`[${ZH.summary}]`);
    expect(json.headlines[0].topic).toBe("[加密货币]");
    expect(json.headlines[0].points).toEqual(["[比特币震荡]", "[以太坊走高]"]);
    expect(json.headlines[1].topic).toBe("[黄金]");
    expect(json.headlines[1].points).toEqual(["[黄金代币续创新高]"]);
    expect(json.analysis.overview).toBe("[整体偏暖。]");
    expect(json.analysis.crypto).toBe("[BTC 报 $64,959.52，上涨 0.92%。]");
    expect(json.analysis.gold).toBe("[XAUT 报 $4,325.51。]");
    expect(json.analysis.watchlist).toEqual(["[关注美联储]", "[关注黄金]"]);
  });

  // C3 的底线：任何一个字段失败都不能悄悄发布另一种语言的正文
  it("任一字段失败就整体失败", async () => {
    const translate = vi.fn(async (text: string) =>
      text === ZH.analysis.gold ? failed("HTTP 429") : okText(`EN ${text.length}`)
    );
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(out.ok).toBe(false);
  });

  it("返回空串同样视为失败", async () => {
    const translate = vi.fn(async (text: string) =>
      okText(text === ZH.title ? "   " : `EN ${text.length}`)
    );
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(out.ok).toBe(false);
  });

  // 这条是这次改动的核心动机：英文版整整几天掉兜底稿，而诊断里只有一句
  // 「翻译失败」。端点被封（429）和「译文语种不对」处置完全不同，必须能分辨。
  it("失败原因带上端点状态码与失败字段计数", async () => {
    const translate = vi.fn(async () => failed("HTTP 429"));
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("HTTP 429");
    expect(out.reason).toContain(`${FIELD_COUNT}/${FIELD_COUNT}`);
  });

  it("同一个原因只汇总一次，不把同一句话抄十几遍", async () => {
    const translate = vi.fn(async () => failed("HTTP 429"));
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    if (out.ok) throw new Error("预期失败");
    expect(out.reason.match(/HTTP 429/g)).toHaveLength(1);
    expect(out.reason).toContain(`HTTP 429×${FIELD_COUNT}`);
  });

  // 免费翻译端点限流时会软失败、原样吐回输入
  it("翻译器原样吐回中文时，en-US 目标判定失败（正文回退链要求 en-US 真的是英文）", async () => {
    const translate = vi.fn(async (text: string) => okText(text));
    const out = await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("语种");
  });

  it("反向：译成中文却全是英文，同样判定失败", async () => {
    const translate = asciiTranslator();
    expect((await translateBriefingJson(ZH, "zh", "zh", "zh-CN", translate)).ok).toBe(false);
  });

  it("单个字段的体积远低于任何 URL 上限（整篇 HTML 正是撞在这里）", async () => {
    const seen: string[] = [];
    const translate = vi.fn(async (text: string) => {
      seen.push(text);
      return okText(`EN ${text.length}`);
    });
    await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    // 质量门槛把 analysis 每段限死在 600 字以内；中文经 encodeURIComponent
    // 约膨胀 9 倍，600 字 ≈ 5.4KB，仍在经典 8KB 请求行上限内
    for (const text of seen) {
      expect(encodeURIComponent(text).length).toBeLessThan(8_000);
    }
  });

  // 旧版是 Promise.all 一把梭：十几个请求同时打向一个免费端点，正是最容易
  // 被判定成突发滥用的形状。降并发治不好 IP 封禁，但没有理由继续制造突发。
  it("不再一次性把十几个请求全发出去", async () => {
    let inFlight = 0;
    let peak = 0;
    const translate = vi.fn(async (text: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return okText(`EN ${text.length}`);
    });
    await translateBriefingJson(ZH, "zh", "en", "en-US", translate);
    expect(translate).toHaveBeenCalledTimes(FIELD_COUNT);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
