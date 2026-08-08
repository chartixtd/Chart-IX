import { describe, it, expect } from "vitest";
import {
  buildBriefingPrompt,
  MAX_SOURCES_IN_PROMPT,
  SECTION_TARGET_MIN,
  SECTION_TARGET_MAX,
} from "./prompt";
import { DEFAULT_MAX_TOKENS } from "./deepseek";
import type { BriefingSource, MarketFact } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
];

const SOURCES: BriefingSource[] = Array.from({ length: 60 }, (_, i) => ({
  title: `Market wrap ${i}`,
  url: `https://example.com/${i}`,
  source: "CoinDesk",
  publishedAt: 60 - i,
  summary: "A neutral summary line.",
}));

describe("buildBriefingPrompt", () => {
  it("含 json 一词——DeepSeek JSON 模式的硬性要求", () => {
    expect(buildBriefingPrompt(SOURCES, FACTS, "zh-CN", "2026-08-08").toLowerCase()).toContain(
      "json"
    );
  });

  it("注入真实行情，且价格格式与质量门槛的正则一致", () => {
    const p = buildBriefingPrompt(SOURCES, FACTS, "zh-CN", "2026-08-08");
    expect(p).toContain("64959.52");
    // 门槛只认带 $ 的价格；这条指令与 PRICE_RE 是一对
    expect(p).toContain("$");
    expect(p).toContain("千分位");
  });

  it("只喂 MAX_SOURCES_IN_PROMPT 条新闻", () => {
    const p = buildBriefingPrompt(SOURCES, FACTS, "zh-CN", "2026-08-08");
    expect(p).toContain(`Market wrap ${MAX_SOURCES_IN_PROMPT - 1}`);
    expect(p).not.toContain(`Market wrap ${MAX_SOURCES_IN_PROMPT}`);
  });

  it("行情为空时明确告知无行情数据，避免模型硬写", () => {
    expect(buildBriefingPrompt(SOURCES, [], "zh-CN", "2026-08-08")).toContain("无行情数据");
  });

  it("英文 locale 要求以英文作答", () => {
    expect(buildBriefingPrompt(SOURCES, FACTS, "en-US", "2026-08-08")).toContain("English");
  });

  /**
   * 这条守的是一次真实事故：prompt 原本要求「每段 80 到 600 字」，三段最多
   * 1800 字，中文约 1 字 1 token，加上要闻、标题、导读与 JSON 结构开销就越过了
   * max_tokens。模型写到上限被截断，finish_reason=length，JSON 解析不出来，
   * 整篇退化成零 AI 兜底稿——而且是间歇性的，写得短的那天就没事。
   *
   * 上限存在，就总有一天会写到上限。所以要求的篇幅必须**留有余量地**装进预算。
   */
  it("要求的篇幅必须留有余量地装进 max_tokens", () => {
    const estimatedChars =
      3 * SECTION_TARGET_MAX + // 三段分析
      80 + // summary
      60 + // title
      3 * 3 * 40 + // headlines：3 主题 × 最多 3 要点 × 每条约 40 字
      4 * 30 + // watchlist 最多 4 条
      200; // JSON 键名、括号、转义等结构开销
    // 中文大致 1 字 ≈ 1 token；留 25% 余量给模型的实际发挥
    expect(estimatedChars).toBeLessThan(DEFAULT_MAX_TOKENS * 0.75);
  });

  it("目标区间本身要合理，且下限高于质量门槛的 SECTION_MIN(80)", () => {
    expect(SECTION_TARGET_MIN).toBeLessThan(SECTION_TARGET_MAX);
    expect(SECTION_TARGET_MIN).toBeGreaterThan(80);
  });

  it("明确要求写完整的 json，宁可紧凑也不要被截断", () => {
    const p = buildBriefingPrompt(SOURCES, FACTS, "zh-CN", "2026-08-08");
    expect(p).toContain("完整");
    expect(p).toContain("截断");
  });
});
