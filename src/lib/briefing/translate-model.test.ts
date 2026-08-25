import { describe, it, expect, vi } from "vitest";
import { buildTranslatePrompt, translateBriefingJsonViaModel } from "./translate-model";
import type { callDeepSeek } from "./deepseek";
import type { BriefingJson } from "./types";

/**
 * 模型翻译通道（L3a）的单元测试。
 *
 * 这条通道的存在理由写在 translate-model.ts 顶部：此前英文版唯一的来源是无鉴权
 * 的 gtx 免费端点，Google 对数据中心 IP 段整体拦截，命中即 429 且与频率无关，
 * 于是英文当天必然掉兜底稿。下面这些用例守的是「换成模型之后不能引入新的
 * 静默失败」——尤其是**结构漂移**：模型很爱把两条要点并成一条，那种译文能过
 * 质量门槛，却让中英两版变成两篇不同的稿子。
 */

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

const EN: BriefingJson = {
  title: "Daily Briefing | August 8 Bitcoin edges higher",
  summary: "Crypto drifted higher over the past 24 hours while gold held its strength.",
  headlines: [
    { topic: "Crypto", points: ["Bitcoin chopped sideways", "Ether pushed higher"] },
    { topic: "Gold", points: ["Gold tokens set another record"] },
  ],
  analysis: {
    overview: "Risk appetite stayed mildly constructive.",
    crypto: "BTC traded at $64,959.52, up 0.92%.",
    gold: "XAUT traded at $4,325.51.",
    watchlist: ["Watch the Fed", "Watch gold"],
  },
};

type Call = typeof callDeepSeek;
type CallArgs = Parameters<Call>[0];

function ok(json: unknown): Awaited<ReturnType<Call>> {
  return { ok: true, content: JSON.stringify(json), finishReason: "stop" };
}

/** 预算永远充足的默认参数——不测预算的用例不该被预算影响 */
function opts(call: Call, over: Partial<Parameters<typeof translateBriefingJsonViaModel>[0]> = {}) {
  return {
    json: ZH,
    targetLocale: "en-US" as const,
    apiKey: "k",
    models: ["m1"],
    deadlineMs: Date.now() + 60_000,
    minCallBudgetMs: 14_000,
    call,
    ...over,
  };
}

describe("buildTranslatePrompt", () => {
  // DeepSeek 的 JSON 模式硬性要求 prompt 里出现 "json" 一词，否则请求直接被拒
  it("含 json 字样，满足 response_format 的前置条件", () => {
    expect(buildTranslatePrompt(ZH, "en-US").toLowerCase()).toContain("json");
  });

  it("把原稿原样嵌进去，模型看得到每一个待译字段", () => {
    const p = buildTranslatePrompt(ZH, "en-US");
    expect(p).toContain("比特币震荡");
    expect(p).toContain("$64,959.52");
  });

  // 质量门槛拿原稿当数字基准核对译文，模型一改写数字整语就掉兜底稿
  it("明确要求数字原样搬运", () => {
    expect(buildTranslatePrompt(ZH, "en-US")).toMatch(/exactly as written/i);
  });
});

describe("translateBriefingJsonViaModel", () => {
  it("正常返回时给出译稿", async () => {
    const call = vi.fn<Call>(async () => ok(EN));
    const out = await translateBriefingJsonViaModel(opts(call));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.json.analysis.crypto).toContain("$64,959.52");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("超时用的是翻译自己的上限，不是生成的 34 秒", async () => {
    const call = vi.fn<Call>(async () => ok(EN));
    await translateBriefingJsonViaModel(opts(call));
    expect(call.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(22_000);
  });

  // 空内容是 DeepSeek 文档明示的偶发问题，同模型重试一次是有意义的
  it("首次失败时换下一个模型再试，并把每次的原因都留在 reason 里", async () => {
    const call = vi
      .fn<Call>()
      .mockResolvedValueOnce({ ok: false, error: "DeepSeek 返回空内容" })
      .mockResolvedValueOnce(ok(EN));
    const out = await translateBriefingJsonViaModel(opts(call, { models: ["m1", "m2"] }));
    expect(out.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0].model).toBe("m2");
  });

  it("全部尝试失败时，reason 逐条列出每个模型的失败原因", async () => {
    const call = vi.fn<Call>(async () => ({ ok: false, error: "HTTP 402 余额不足" }));
    const out = await translateBriefingJsonViaModel(opts(call, { models: ["m1", "m2"] }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("m1: HTTP 402");
    expect(out.reason).toContain("m2: HTTP 402");
  });

  it("输出被截断时判失败——截断的 json 解析不出来，先说清为什么", async () => {
    const call = vi.fn<Call>(async () => ({
      ok: true,
      content: JSON.stringify(EN),
      finishReason: "length",
    }));
    const out = await translateBriefingJsonViaModel(opts(call));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("截断");
  });

  it("返回值不是 json 时判失败", async () => {
    const call = vi.fn<Call>(async () => ({ ok: true, content: "抱歉，我无法翻译", finishReason: "stop" }));
    expect((await translateBriefingJsonViaModel(opts(call))).ok).toBe(false);
  });

  // 结构漂移是模型翻译独有的风险：gtx 逐字段翻译不可能少一条，模型会。
  // 质量门槛只查条数落在允许区间内，查不出「本来 3 条被并成 2 条」。
  it("要点被并条时判失败，中英两版不允许各说各话", async () => {
    const merged: BriefingJson = {
      ...EN,
      headlines: [
        { topic: "Crypto", points: ["Bitcoin chopped sideways and ether pushed higher"] },
        EN.headlines[1],
      ],
    };
    const call = vi.fn<Call>(async () => ok(merged));
    const out = await translateBriefingJsonViaModel(opts(call));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("points 条数");
  });

  it("watchlist 少一条同样判失败", async () => {
    const short: BriefingJson = {
      ...EN,
      analysis: { ...EN.analysis, watchlist: ["Watch the Fed"] },
    };
    const call = vi.fn<Call>(async () => ok(short));
    const out = await translateBriefingJsonViaModel(opts(call));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("watchlist 条数");
  });

  it("模型把中文原样吐回时判失败，绝不把中文当英文发", async () => {
    const call = vi.fn<Call>(async () => ok(ZH));
    const out = await translateBriefingJsonViaModel(opts(call));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("语种");
  });

  // 预算耗尽时不能起一次注定超时的调用——那会把留给 gtx 备胎和落库的时间烧光
  it("剩余预算不足时一次都不调用，并说明是预算问题", async () => {
    const call = vi.fn<Call>(async () => ok(EN));
    const out = await translateBriefingJsonViaModel(
      opts(call, { deadlineMs: Date.now() + 3_000 })
    );
    expect(call).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("剩余预算");
  });

  it("每次尝试的耗时都报给调用方，超时值才有实测依据可调", async () => {
    const seen: string[] = [];
    const call = vi.fn<Call>(async () => ok(EN));
    await translateBriefingJsonViaModel(opts(call, { onAttempt: (m) => seen.push(m) }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("耗时");
  });

  // 生成阶段的 timeoutMs 会被剩余预算二次收窄，翻译这一路必须有同样的性质，
  // 否则最后一次尝试会跨过 deadline，被平台掐断的正是那条什么都没写的路径
  it("超时被剩余预算二次收窄，最后一次尝试不跨过 deadline", async () => {
    const call = vi.fn<Call>(async () => ok(EN));
    await translateBriefingJsonViaModel(
      opts(call, { deadlineMs: Date.now() + 16_000, minCallBudgetMs: 14_000 })
    );
    expect(call.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(16_000);
  });

  it("把 apiKey 与模型名如实传给客户端", async () => {
    const call = vi.fn<Call>(async () => ok(EN));
    await translateBriefingJsonViaModel(opts(call, { apiKey: "secret", models: ["mx"] }));
    const args: CallArgs = call.mock.calls[0][0];
    expect(args.apiKey).toBe("secret");
    expect(args.model).toBe("mx");
  });
});
