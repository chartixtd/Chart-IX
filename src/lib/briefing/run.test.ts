import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BriefingJson, BriefingSource, MarketFact } from "./types";

/**
 * 降级阶梯（L3/L4/L5）的端到端测试。
 *
 * 三个 Critical 全都住在 run.ts 的分支选择里，而在此之前没有任何测试能到达那里：
 * 每个任务各自的单元测试都绿，失败只在几块拼到一起时才出现。这比一次真实冒烟
 * 测试更有价值——带着可用 API key 的冒烟测试永远不会走到这些分支。
 *
 * 全部外部依赖都打桩，不碰 DeepSeek、不碰数据库、不碰翻译端点。
 */

interface CallOpts {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}
type CallResult =
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; error: string };
interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string | null;
  failed_count: number;
}
interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

const callDeepSeek = vi.fn<(opts: CallOpts) => Promise<CallResult>>();
const fetchBriefingSources = vi.fn<(nowMs: number) => Promise<BriefingSource[]>>();
const fetchMarketFacts = vi.fn<() => Promise<MarketFact[]>>();
const translateText = vi.fn<(text: string, from: string, to: string) => Promise<string | null>>();
const alertBriefing = vi.fn<(message: string) => Promise<void>>(async () => {});
const sendToSubscriptions =
  vi.fn<(rows: SubRow[], payload: PushPayload) => Promise<{ sent: number; removed: number }>>(
    async () => ({ sent: 0, removed: 0 })
  );
const getOptedInSubscriptions = vi.fn<(pref: string) => Promise<SubRow[]>>(async () => []);

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => db.client(),
}));
vi.mock("@/lib/push/send", () => ({
  getOptedInSubscriptions: (pref: string) => getOptedInSubscriptions(pref),
  sendToSubscriptions: (rows: SubRow[], payload: PushPayload) =>
    sendToSubscriptions(rows, payload),
}));
vi.mock("@/lib/briefing/alert", () => ({
  alertBriefing: (message: string) => alertBriefing(message),
}));
vi.mock("@/lib/briefing/deepseek", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deepseek")>()),
  callDeepSeek: (opts: CallOpts) => callDeepSeek(opts),
}));
vi.mock("@/lib/briefing/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sources")>()),
  fetchBriefingSources: (nowMs: number) => fetchBriefingSources(nowMs),
}));
vi.mock("@/lib/briefing/market-facts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./market-facts")>()),
  fetchMarketFacts: () => fetchMarketFacts(),
}));
vi.mock("@/lib/translate", () => ({
  translateText: (text: string, from: string, to: string) => translateText(text, from, to),
}));

const { runDailyBriefing } = await import("./run");

/* ── Supabase 打桩 ── */

interface InsertedArticle {
  slug: string;
  title: Record<string, string>;
  content: Record<string, string>;
}

const db = {
  existingArticle: null as { id: string } | null,
  pushEnabled: false as boolean,
  insertError: null as { code?: string; message: string } | null,
  inserted: [] as InsertedArticle[],
  beats: [] as string[],
  throwOnClient: false,

  reset() {
    db.existingArticle = null;
    db.pushEnabled = false;
    db.insertError = null;
    db.inserted = [];
    db.beats = [];
    db.throwOnClient = false;
  },

  client() {
    if (db.throwOnClient) throw new Error("supabase unavailable");
    const single = (data: unknown) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }),
    });
    return {
      from(table: string) {
        switch (table) {
          case "cron_heartbeats":
            return {
              upsert: async (row: { last_status: string }) => {
                db.beats.push(row.last_status);
                return { error: null };
              },
            };
          case "articles":
            return {
              ...single(db.existingArticle),
              insert: async (row: InsertedArticle) => {
                if (db.insertError) return { error: db.insertError };
                db.inserted.push(row);
                return { error: null };
              },
            };
          case "article_categories":
            return single({ id: "cat-1" });
          case "admin_settings":
            return single({ value: db.pushEnabled });
          default:
            throw new Error(`unexpected table ${table}`);
        }
      },
    } as never;
  },
};

/* ── 素材夹具 ── */

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "ETH-USDT", label: "ETH", lastPrice: 1914.99, change24hPct: 0.59 },
  { symbol: "SOL-USDT", label: "SOL", lastPrice: 132.4, change24hPct: -2.11 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: 1.37 },
];

// 全英文标题：这样「en-US 正文不含 CJK」这条断言只会被中文正文串台触发。
// 条数取 40（= 渲染层的来源上限），这是正常一天的真实体量；实测这样渲染出的
// 中文 HTML 编码后 10,568 字节，整篇丢进 GET 查询串必然被打回。
const SOURCES: BriefingSource[] = Array.from({ length: 40 }, (_, i) => ({
  title: `Market wrap number ${i}`,
  url: `https://example.com/${i}`,
  source: "CoinDesk",
  publishedAt: 40 - i,
  summary: "A neutral summary line.",
}));

const ZH_JSON: BriefingJson = {
  title: "早报 | 8月8日 比特币小幅上行，黄金续创新高",
  summary: "过去二十四小时加密市场温和上行，黄金延续强势，宏观面关注美联储表态。",
  headlines: [
    { topic: "加密货币", points: ["比特币在六万四千美元上方反复震荡", "以太坊跟随大盘小幅走高"] },
    { topic: "黄金与大宗", points: ["黄金代币续创阶段新高，避险资金持续流入"] },
    { topic: "宏观金融", points: ["市场等待本周公布的通胀数据"] },
  ],
  analysis: {
    overview:
      "过去二十四小时市场整体偏暖，风险资产与避险资产同步走高，反映资金面宽松而非单边押注方向。这种组合通常出现在宏观预期尚未收敛的阶段，市场既不愿全面撤离风险，也不敢放弃避险头寸，因而呈现两头都不放的状态，等待更明确的政策指引。",
    crypto:
      "BTC 报 $64,959.52，二十四小时上涨 0.92%，涨幅温和且未伴随异常放量，属于区间内的正常波动。从成交结构看，买盘并未出现明显的集中释放，尚不足以判定趋势发生改变，需要继续观察后续几个交易日成交能否跟上。",
    gold: "黄金代币 XAUT 报 $4,325.51，二十四小时上涨 1.37%，明显强于同期加密资产，显示避险需求仍在累积。这与近期宏观不确定性上升的背景一致，后续值得留意其与实际利率之间的关系是否继续背离。",
    watchlist: ["关注美联储官员本周的公开讲话", "关注黄金能否站稳当前阶段高位"],
  },
};

const EN_JSON: BriefingJson = {
  title: "Daily Briefing | Bitcoin steady, gold tokens extend gains",
  summary:
    "Risk assets and gold tokens both firmed over the past day, with macro expectations still unsettled.",
  headlines: [
    {
      topic: "Crypto",
      points: [
        "Bitcoin held its range through Asian hours",
        "Ether tracked the broader market higher",
      ],
    },
    {
      topic: "Gold and commodities",
      points: ["Gold tokens pushed to fresh highs on steady haven demand"],
    },
    { topic: "Macro", points: ["Traders wait on this week's inflation print"] },
  ],
  analysis: {
    overview:
      "Bitcoin spent the session in consolidation near $64,959.52 before easing, while gold tokens quietly outperformed. That combination usually shows up when macro expectations have not converged, and it argues for patience rather than conviction in either direction over the next few sessions.",
    crypto:
      "It remains unclear whether the bid persists, though ETH changed hands at $1,914.99 with a 0.59% gain over the past day. Volume did not confirm the move, so the range stays intact until buyers turn up in size and carry price through the prior high.",
    gold: "Gold tokens are solidly bid, with XAUT at $4,325.51 after a 1.37% advance that outpaced the major crypto assets. Whether that holds depends on real rates, which have drifted lower for three straight sessions and remain the cleanest read on haven demand.",
    watchlist: [
      "Fed speakers on the calendar this week",
      "Whether gold tokens can hold their recent highs",
    ],
  },
};

/** UTC 01:00 = UTC+8 09:00，落在发布时间窗内 */
const NOW = Date.parse("2026-08-08T01:00:00Z");
/** UTC 16:00 = UTC+8 次日 00:00，日期已翻篇但当地还是半夜 */
const MIDNIGHT_UTC8 = Date.parse("2026-08-08T16:00:00Z");

const CJK_RE = /[一-鿿]/;

function ok(json: BriefingJson): CallResult {
  return { ok: true, content: JSON.stringify(json), finishReason: "stop" };
}
const FAIL: CallResult = { ok: false, error: "DeepSeek 返回空内容" };

/** en-US 的 prompt 里有这句英文指令，中文的没有 */
function isEnglishPrompt(opts: { prompt: string }) {
  return opts.prompt.includes("Write the entire response in English");
}

/**
 * 长度相当的英文占位译文。
 *
 * 替身不能只吐一个短标记：翻译产物现在要重跑 checkBriefing（见「L3 翻译结果
 * 重新过门槛」一节），而门槛对标题、导读、分析段都有长度下限，短标记会让每个
 * 用例都以「长度不合格」落到兜底稿，翻译通道本身反而失去覆盖。
 * 这里按输入字符数的两倍生成英文单词——正是中译英的典型膨胀倍率。
 */
const FILLER_WORDS = ["market", "traders", "session", "demand", "range", "volume", "macro", "signal"];
function fakeEnglish(text: string): string {
  const target = Math.min(500, Math.max(30, [...text].length * 2));
  const words: string[] = [];
  for (let i = 0, len = 0; len < target; i++) {
    const w = FILLER_WORDS[i % FILLER_WORDS.length];
    words.push(w);
    len += w.length + 1;
  }
  return words.join(" ");
}

/**
 * 贴近真实的翻译端点替身。
 *
 * translateText 把内容放在 GET 查询串里，超过请求行上限的调用会拿到非 2xx
 * 并返回 null——C3 正是撞在这里：整篇早报 HTML 编码后 6.6KB 起步（零来源的
 * 下限），典型日 23KB。这里照抄那条边界，好让「整篇丢进去」这种写法必然翻车，
 * 而逐字段调用（最长的 analysis 段被门槛限死 ≤600 字）必然通过。
 */
const URL_LIMIT_BYTES = 8_000;
function realisticTranslator() {
  return vi.fn(async (text: string) =>
    encodeURIComponent(text).length > URL_LIMIT_BYTES ? null : fakeEnglish(text)
  );
}

beforeEach(() => {
  db.reset();
  callDeepSeek.mockReset();
  fetchBriefingSources.mockReset().mockResolvedValue(SOURCES);
  fetchMarketFacts.mockReset().mockResolvedValue(FACTS);
  translateText.mockReset();
  alertBriefing.mockReset().mockImplementation(async () => {});
  sendToSubscriptions.mockClear();
  getOptedInSubscriptions.mockReset().mockResolvedValue([]);
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.BRIEFING_AUTHOR_ID = "author-1";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.BRIEFING_AUTHOR_ID;
});

describe("runDailyBriefing — 正常路径", () => {
  it("两语都通过时发布双语正文", async () => {
    callDeepSeek.mockImplementation(async (opts) => ok(isEnglishPrompt(opts) ? EN_JSON : ZH_JSON));
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].content["zh-CN"]).toContain("行情快照");
    expect(db.inserted[0].content["en-US"]).toContain("Market Snapshot");
    expect(db.beats).toContain("ok");
  });

  it("今天已经出过稿时早退，不调用模型", async () => {
    db.existingArticle = { id: "a1" };
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });
});

// ── C3：一语失败时的翻译通道 ──
describe("runDailyBriefing — L3 翻译通道", () => {
  it("en-US 三次尝试全失败时，content['en-US'] 必须不含 CJK", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    // 打桩成一个真的会把中文换掉的翻译器
    translateText.mockImplementation(realisticTranslator());

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    const article = db.inserted[0];
    // 这一条断言在修复前就会红：旧实现把整篇中文 HTML 当成 en-US 发布
    expect(CJK_RE.test(article.content["en-US"])).toBe(false);
    expect(CJK_RE.test(article.title["en-US"])).toBe(false);
    // 中文那一语原样保留
    expect(CJK_RE.test(article.content["zh-CN"])).toBe(true);
  });

  it("翻译走的是字段而不是整篇 HTML——小标题与括号样式都被正确本地化", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockImplementation(realisticTranslator());

    await runDailyBriefing(NOW);
    const en = db.inserted[0].content["en-US"];
    expect(en).toContain("Market Read");
    expect(en).toContain("Sources");
    expect(en).toContain("(24h +0.92%)");
    expect(en).not.toContain("（");
    // 价格与链接不经过翻译器，原样保留
    expect(en).toContain("$64,959.52");
    expect(en).toContain('href="https://example.com/0"');
    // HTML 整篇没有被丢进翻译器
    for (const call of translateText.mock.calls) {
      expect(call[0]).not.toContain("<");
    }
  });

  it("翻译通道失败时落到兜底稿，绝不把中文正文当成 en-US 发布", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(CJK_RE.test(db.inserted[0].content["en-US"])).toBe(false);
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("翻译通道也失败"))).toBe(true);
    // 绝不能再出现「已用翻译通道兜住」这种谎报成功的告警
    expect(messages.some((m) => m.includes("已用翻译通道兜住"))).toBe(false);
  });

  it("翻译器原样吐回中文时同样落到兜底稿", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockImplementation(async (text: string) => text);

    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("fallback");
    expect(CJK_RE.test(db.inserted[0].content["en-US"])).toBe(false);
  });

  // ── D：翻译失败时不能把已经过门槛的那一语一起丢掉 ──
  it("翻译失败时保留 AI 中文稿，只让英文落到兜底稿", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    const a = db.inserted[0];
    // 中文仍是 AI 稿：标题原样、正文里有 AI 写的分析段与「市场解读」小标题
    expect(a.title["zh-CN"]).toBe(ZH_JSON.title);
    expect(a.content["zh-CN"]).toContain(ZH_JSON.analysis.gold);
    expect(a.content["zh-CN"]).toContain("市场解读");
    // 英文才是兜底稿
    expect(a.title["en-US"]).toContain("24-Hour News Roundup");
    expect(a.content["en-US"]).toContain("Last 24 Hours");
    expect(a.content["en-US"]).not.toContain("Market Read");
  });

  it("反向也成立：中文失败且翻译失败时，英文 AI 稿保留，中文用兜底稿", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? ok(EN_JSON) : FAIL));
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    const a = db.inserted[0];
    expect(a.title["en-US"]).toBe(EN_JSON.title);
    expect(a.content["en-US"]).toContain("Market Read");
    expect(a.title["zh-CN"]).toContain("24 小时要闻速览");
    expect(a.content["zh-CN"]).toContain("24 小时要闻");
    expect(a.content["zh-CN"]).not.toContain("市场解读");
  });

  // ── C：翻译产物要重跑 checkBriefing，而不只是查语种占比 ──
  it("翻译结果含禁用表述时当作翻译失败，不会绕过质量门槛发出去", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    // 机器翻译把中文的合规措辞译成了 BANNED_PHRASES 里的英文条目
    translateText.mockImplementation(async (text: string) => `${fakeEnglish(text)} price target`);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(db.inserted[0].content["en-US"]).toContain("Last 24 Hours");
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) => m.includes("翻译结果未过质量门槛") && m.includes("banned-phrase"))
    ).toBe(true);
  });

  it("翻译把标题撑过 TITLE_MAX 时同样落到兜底稿", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockImplementation(async (text: string) =>
      text === ZH_JSON.title ? "Bitcoin ".repeat(12).trim() : fakeEnglish(text)
    );

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("翻译结果未过质量门槛") && m.includes("length"))).toBe(
      true
    );
  });

  it("翻译结果过得了完整门槛时照常走翻译通道", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockImplementation(realisticTranslator());

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    expect(db.inserted[0].content["en-US"]).toContain("Market Read");
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("翻译结果未过质量门槛"))).toBe(false);
  });

  it("generateOne 抛出时 rejection 原因会被告警，而不是静默丢弃", async () => {
    callDeepSeek.mockImplementation(async (opts) => {
      if (isEnglishPrompt(opts)) throw new Error("kaboom");
      return ok(ZH_JSON);
    });
    translateText.mockImplementation(realisticTranslator());

    await runDailyBriefing(NOW);
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("抛出异常") && m.includes("kaboom"))).toBe(true);
  });
});

// ── L4/L5：兜底稿 ──
describe("runDailyBriefing — L4 兜底稿", () => {
  it("两语都失败时插入兜底稿并写心跳", async () => {
    callDeepSeek.mockResolvedValue(FAIL);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].title["zh-CN"]).toContain("24 小时要闻速览");
    expect(db.inserted[0].title["en-US"]).toContain("24-Hour News Roundup");
    expect(db.inserted[0].content["en-US"]).toContain("Last 24 Hours");
    expect(db.beats).toContain("ok");
  });

  // I2：结构合法但元素类型漂移曾在渲染器里抛 TypeError，把整轮打成 failed
  // 并**绕过**兜底稿。门槛拦下后必须优雅降级。
  it("模型吐出对象型 watchlist 时降级成兜底稿，而不是崩成 failed", async () => {
    const drifted = {
      ...ZH_JSON,
      analysis: {
        ...ZH_JSON.analysis,
        watchlist: [{ title: "关注美联储", detail: "本周讲话" }],
      },
    };
    callDeepSeek.mockResolvedValue({
      ok: true,
      content: JSON.stringify(drifted),
      finishReason: "stop",
    } as CallResult);

    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("fallback");
    expect(db.inserted).toHaveLength(1);
  });

  it("新闻不足 MIN_SOURCE_ITEMS 时直接走兜底稿，不调用模型", async () => {
    fetchBriefingSources.mockResolvedValue(SOURCES.slice(0, 3));
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("fallback");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it("L5：新闻与行情全空时判 failed 并写 error 心跳", async () => {
    fetchBriefingSources.mockResolvedValue([]);
    fetchMarketFacts.mockResolvedValue([]);
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("failed");
    expect(db.beats).toContain("error");
    expect(db.inserted).toHaveLength(0);
  });
});

// ── C2：墙钟预算 ──
describe("runDailyBriefing — 墙钟预算", () => {
  it("模型每次都耗尽超时预算时，流水线仍带着兜底稿走到落库", async () => {
    vi.useFakeTimers();
    // 打桩成一个「睡过整个超时」的实现，正是被平台掐断前的真实形态
    callDeepSeek.mockImplementation(async (opts: { timeoutMs: number }) => {
      await new Promise((resolve) => setTimeout(resolve, opts.timeoutMs));
      return { ok: false, error: "This operation was aborted" } as CallResult;
    });

    const started = Date.now();
    const pending = runDailyBriefing(NOW);
    await vi.runAllTimersAsync();
    const r = await pending;
    const elapsed = Date.now() - started;

    expect(r.status).toBe("fallback");
    expect(db.inserted).toHaveLength(1);
    expect(db.beats).toContain("ok");
    // 预算 48s：两语并发、每语最多两次 22s 的尝试，第三次因剩余不足被拦下
    expect(elapsed).toBeLessThan(48_000);
    expect(callDeepSeek.mock.calls.length).toBeLessThan(6);
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("剩余预算"))).toBe(true);
  });

  // ── R2：告警路径不能重新把流水线挂死 ──
  it("失败告警不 await——被限流的 Telegram 不会再把流水线拖过 maxDuration", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    // 一条被限流的告警最多耗约 31.5 秒（10s 超时 × 3 次 + retry_after 退避），
    // 而糟糕的一天会连发 6-9 条。这里干脆让告警永远不 resolve：只要还有一处
    // await 落在循环内的告警上，流水线就再也走不到落库。
    alertBriefing.mockImplementation(() => new Promise<void>(() => {}));

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(db.inserted).toHaveLength(1);
    expect(db.beats).toContain("ok");
    // 告警确实发起了，只是没被等待
    expect(alertBriefing.mock.calls.length).toBeGreaterThan(0);
  });

  it("每次调用都带上不超过剩余预算的 timeoutMs", async () => {
    vi.useFakeTimers();
    callDeepSeek.mockImplementation(async (opts: { timeoutMs: number }) => {
      await new Promise((resolve) => setTimeout(resolve, opts.timeoutMs));
      return { ok: false, error: "aborted" } as CallResult;
    });

    const pending = runDailyBriefing(NOW);
    await vi.runAllTimersAsync();
    await pending;

    for (const call of callDeepSeek.mock.calls) {
      expect(call[0].timeoutMs).toBeGreaterThan(0);
      expect(call[0].timeoutMs).toBeLessThanOrEqual(22_000);
    }
  });
});

// ── I4：发布时间窗 ──
describe("runDailyBriefing — 发布时间窗", () => {
  it("UTC+8 半夜的 tick 直接 skipped，不出稿", async () => {
    callDeepSeek.mockImplementation(async (opts) => ok(isEnglishPrompt(opts) ? EN_JSON : ZH_JSON));
    const r = await runDailyBriefing(MIDNIGHT_UTC8);
    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
    expect(db.inserted).toHaveLength(0);
    expect(db.beats).toEqual(["idle"]);
  });

  // ── B：两种「没出稿」的心跳必须能区分 ──
  // 共用一个状态值时，窗口外的 tick 会把发文后的 ok 覆盖掉，cron_heartbeats
  // 从此回答不了「今天的早报发出去了吗」——监控看到的永远是同一个绿灯。
  it("窗口外写 idle，今天已有稿写 skipped——两者不共用状态值", async () => {
    callDeepSeek.mockImplementation(async (opts) => ok(isEnglishPrompt(opts) ? EN_JSON : ZH_JSON));

    await runDailyBriefing(MIDNIGHT_UTC8);
    expect(db.beats).toEqual(["idle"]);

    db.beats = [];
    db.existingArticle = { id: "a1" };
    await runDailyBriefing(NOW);
    expect(db.beats).toEqual(["skipped"]);
  });

  it("唯一约束冲突同样写 skipped——它也意味着今天已经有稿", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    db.insertError = { code: "23505", message: "duplicate key" };
    await runDailyBriefing(NOW);
    expect(db.beats).toEqual(["skipped"]);
  });

  it("后台手动触发（ignoreSchedule）可以绕过时间窗", async () => {
    callDeepSeek.mockImplementation(async (opts) => ok(isEnglishPrompt(opts) ? EN_JSON : ZH_JSON));
    const r = await runDailyBriefing(MIDNIGHT_UTC8, { ignoreSchedule: true });
    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
  });

  it("窗口内的 tick 正常进入流水线", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    // UTC 03:59 = UTC+8 11:59，窗口末端
    const r = await runDailyBriefing(Date.parse("2026-08-08T03:59:00Z"));
    expect(r.status).toBe("fallback");
  });
});

describe("runDailyBriefing — 永不抛出", () => {
  it("依赖抛出时归一成 failed 而不是把异常抛给路由", async () => {
    db.throwOnClient = true;
    const r = await runDailyBriefing(NOW, { ignoreSchedule: true });
    expect(r.status).toBe("failed");
    expect(r.slug).toBe("daily-briefing-2026-08-08");
  });

  it("nowMs 非有限时仍返回结果，slug 退化成 unknown", async () => {
    const r = await runDailyBriefing(Number.NaN, { ignoreSchedule: true });
    expect(r.status).toBe("failed");
    expect(r.slug).toBe("unknown");
  });

  it("落库遇到唯一约束冲突判为 skipped，不算失败", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    db.insertError = { code: "23505", message: "duplicate key" };
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("skipped");
  });
});

describe("runDailyBriefing — 推送分组", () => {
  it("订阅行的 locale 为 null 时回落到 en-US，链接不会变成 /undefined/", async () => {
    callDeepSeek.mockImplementation(async (opts) => ok(isEnglishPrompt(opts) ? EN_JSON : ZH_JSON));
    db.pushEnabled = true;
    getOptedInSubscriptions.mockResolvedValue([
      { id: "s1", endpoint: "e", p256dh: "p", auth: "a", locale: null, failed_count: 0 },
    ]);

    await runDailyBriefing(NOW);

    expect(sendToSubscriptions).toHaveBeenCalledTimes(1);
    const payload = sendToSubscriptions.mock.calls[0][1] as { url: string };
    expect(payload.url).toBe("/en-US/articles/daily-briefing-2026-08-08");
  });
});
