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
const fetchArticleBodies = vi.fn(async (sources: BriefingSource[]) =>
  sources.map((s) => ({ ...s, body: "" }))
);
const revalidateArticleLists = vi.fn();
const pushBriefingToTelegram =
  vi.fn<
    (slug: string, titles: Record<string, string>) => Promise<{
      skippedReason?: string;
      results: { label: string; ok: boolean; error?: string }[];
    }>
  >(async () => ({ skippedReason: "no_targets", results: [] }));

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
// 正文抓取会真的发 HTTP 请求：不挡掉的话，假定时器下的预算测试会永远挂住，
// 而且单元测试本就不该碰网络。默认返回「一篇正文都没抓到」——这是最常见的
// 真实形态（付费墙、反爬），流水线必须在这种情况下照常出稿。
vi.mock("@/lib/briefing/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./extract")>()),
  fetchArticleBodies: (sources: BriefingSource[]) => fetchArticleBodies(sources),
}));
// 不用 importOriginal：真模块会拉进 telegram-push → screener-server 与加密模块，
// 而 supabase 替身对 telegram_* 表一律抛 "unexpected table"。预算常量在这里重写
// 一份，是为了让这条测试完全不依赖那整条栈。
vi.mock("@/lib/briefing/telegram", () => ({
  BRIEFING_TELEGRAM_BUDGET_MS: 9_000,
  pushBriefingToTelegram: (slug: string, titles: Record<string, string>) =>
    pushBriefingToTelegram(slug, titles),
}));
// translateBriefingJson 现在用的是带失败原因的 translateTextDetailed。替身仍然
// 复用同一个 translateText mock（用例里到处都是 `mockResolvedValue(null)` 这种
// 写法），只在这里把 string|null 包成结果对象——改签名不该让每条用例重写一遍。
vi.mock("@/lib/translate", () => ({
  translateText: (text: string, from: string, to: string) => translateText(text, from, to),
  translateTextDetailed: async (text: string, from: string, to: string) => {
    const out = await translateText(text, from, to);
    return out === null ? { ok: false, reason: "stub: null" } : { ok: true, text: out };
  },
}));
// revalidatePath 只能在真实请求上下文里调用，测试里会打印
// "static generation store missing" 的报错噪音——测试输出必须干净
vi.mock("@/lib/articles-revalidate", () => ({
  revalidateArticleLists: () => revalidateArticleLists(),
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
  deletedSlugs: [] as string[],
  deleteError: null as { message: string } | null,
  lastRun: null as { status: string; slug: string; reasons: string[] } | null,
  publishState: null as { slug: string; degraded: boolean; attempts: number } | null,

  reset() {
    db.existingArticle = null;
    db.pushEnabled = false;
    db.insertError = null;
    db.inserted = [];
    db.beats = [];
    db.throwOnClient = false;
    db.deletedSlugs = [];
    db.deleteError = null;
    db.lastRun = null;
    db.publishState = null;
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
              delete: () => ({
                eq: async (_col: string, value: string) => {
                  if (db.deleteError) return { error: db.deleteError };
                  db.deletedSlugs.push(value);
                  db.existingArticle = null;
                  return { error: null };
                },
              }),
            };
          case "article_categories":
            return single({ id: "cat-1" });
          case "admin_settings":
            // 按 key 分派：这张表现在同时存着推送开关、上次运行诊断和发布状态，
            // 一律返回同一个值的话，readPublishState 永远读不到测试摆好的状态。
            return {
              select: () => ({
                eq: (_col: string, key: string) => ({
                  maybeSingle: async () => ({
                    data:
                      key === "daily_briefing_push_enabled"
                        ? { value: db.pushEnabled }
                        : key === "daily_briefing_publish_state"
                          ? db.publishState && { value: db.publishState }
                          : null,
                  }),
                }),
              }),
              upsert: async (row: { key: string; value: unknown }) => {
                if (row.key === "daily_briefing_last_run") {
                  db.lastRun = row.value as typeof db.lastRun;
                }
                if (row.key === "daily_briefing_publish_state") {
                  db.publishState = row.value as typeof db.publishState;
                }
                return { error: null };
              },
            };
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
 * 翻译 prompt 与生成 prompt 走的是同一个 callDeepSeek，替身必须能分开它们。
 *
 * 分不开的话，`callDeepSeek.mockResolvedValue(ok(ZH_JSON))` 会让「翻译」也返回
 * 中文原稿——那恰好是 L3a 的语种自检要拦的东西，于是每条用例都在悄悄走备胎，
 * 测的东西和以为在测的东西对不上。
 */
function isTranslatePrompt(opts: { prompt: string }) {
  return opts.prompt.includes("professional financial translator");
}

/** 生成调用（不含翻译调用）的次数 */
function generationCalls() {
  return callDeepSeek.mock.calls.filter((c) => !isTranslatePrompt(c[0]));
}

/** 把一篇中文稿逐字段换成长度相当的英文占位，模拟一次成功的模型翻译 */
function toFakeEnglishJson(b: BriefingJson): BriefingJson {
  return {
    title: fakeEnglish(b.title),
    summary: fakeEnglish(b.summary),
    headlines: b.headlines.map((h) => ({
      topic: fakeEnglish(h.topic),
      points: h.points.map(fakeEnglish),
    })),
    analysis: {
      overview: fakeEnglish(b.analysis.overview),
      crypto: fakeEnglish(b.analysis.crypto),
      gold: fakeEnglish(b.analysis.gold),
      watchlist: b.analysis.watchlist.map(fakeEnglish),
    },
  };
}

/**
 * 生产形态的模型替身：生成 prompt 出中文稿，翻译 prompt 出等价英文稿。
 *
 * 只写 `callDeepSeek.mockResolvedValue(ok(ZH_JSON))` 的用例，翻译那一路拿到的
 * 也是中文——L3a 的语种自检会拒掉它，于是实际走的是 gtx 备胎。那对「专测备胎」
 * 的用例正合适，但「正常发布」必须走主路，否则测的是降级路径却以为是正常路径。
 */
function modelWithTranslation(zh: BriefingJson = ZH_JSON) {
  return async (opts: CallOpts): Promise<CallResult> =>
    isTranslatePrompt(opts) ? ok(toFakeEnglishJson(zh)) : ok(zh);
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
/**
 * 假翻译器。倍率 2.4 不是随手取的：中文一个字承载的信息约等于英文两到三个
 * 字符，线上实测同一篇稿子中文标题 30 字译出 127 字符、段落 250 字译出 695
 * 字符。早期版本按「长度不变」建模，于是英文的长度阈值怎么调都测不出问题——
 * 夹具必须和现实同构，否则它守的是一个不存在的世界。
 */
function fakeEnglish(text: string): string {
  const target = Math.min(1400, Math.max(30, Math.round([...text].length * 2.4)));
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
  // 新设计下英文一律由中文翻译而来，所以「正常」默认就得有个能用的翻译器
  translateText.mockReset().mockImplementation(async (text: string) => fakeEnglish(text));
  alertBriefing.mockReset().mockImplementation(async () => {});
  sendToSubscriptions.mockClear();
  getOptedInSubscriptions.mockReset().mockResolvedValue([]);
  fetchArticleBodies.mockReset().mockImplementation(async (sources: BriefingSource[]) =>
    sources.map((s) => ({ ...s, body: "" }))
  );
  revalidateArticleLists.mockClear();
  pushBriefingToTelegram.mockReset().mockResolvedValue({ skippedReason: "no_targets", results: [] });
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.BRIEFING_AUTHOR_ID = "author-1";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.BRIEFING_AUTHOR_ID;
});

describe("runDailyBriefing — 正常路径", () => {
  it("中文生成成功、英文由翻译产出，双语正文都落库", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].content["zh-CN"]).toContain("行情快照");
    expect(db.inserted[0].content["en-US"]).toContain("Market Snapshot");
    expect(db.beats).toContain("ok");
  });

  // 这是改成「单次生成 + 翻译」的全部理由：英文原生生成要 24 秒以上还常返回空，
  // 而承载路由只有 60 秒硬上限。生成只打一次，预算才有余量。
  //
  // 注意「生成一次」不等于「调用模型一次」：翻译现在也走模型（L3a），但那是
  // 一次照抄式的短调用，与「用同一批素材再写一遍英文稿」完全不是一回事。
  it("只对主语言生成一次，不再为英文单独生成", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    await runDailyBriefing(NOW);
    expect(generationCalls()).toHaveLength(1);
    expect(isEnglishPrompt(generationCalls()[0][0])).toBe(false);
  });

  it("英文正文不含 CJK——翻译真的发生了，不是把中文塞进 en-US", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    await runDailyBriefing(NOW);
    expect(CJK_RE.test(db.inserted[0].content["en-US"])).toBe(false);
  });

  it("今天已经出过稿时早退，不调用模型", async () => {
    db.existingArticle = { id: "a1" };
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  // 列表页有 5 分钟静态缓存；不主动失效的话，9 点发的早报要到 9:05 才上列表
  it("发布成功后主动失效文章列表缓存", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    await runDailyBriefing(NOW);
    expect(revalidateArticleLists).toHaveBeenCalled();
  });

  it("skipped 早退不触发缓存失效", async () => {
    db.existingArticle = { id: "a1" };
    await runDailyBriefing(NOW);
    expect(revalidateArticleLists).not.toHaveBeenCalled();
  });
});

// 线上第一次真跑就发现：兜底稿发出来了，但「为什么没走 AI」只在 Sentry 里，
// 后台一无所知。这组用例锁住"降级必须自带可读原因"。
describe("runDailyBriefing — 降级诊断", () => {
  it("降级时把每条原因随结果返回", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("fallback");
    expect(r.reasons?.length).toBeGreaterThan(0);
    expect(r.reasons?.join("\n")).toContain("调用失败");
  });

  it("正常发布时只留成功记录，不含任何失败原因", async () => {
    callDeepSeek.mockImplementation(modelWithTranslation());
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("published");
    const log = (r.reasons ?? []).join("\n");
    expect(log).toContain("zh-CN 第 1 次生成成功");
    expect(log).toContain("en-US 已由 zh-CN 翻译生成");
    expect(log).not.toContain("失败");
    expect(log).not.toContain("未过质量门槛");
  });

  it("成功记录带耗时，供调超时值使用", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    const r = await runDailyBriefing(NOW);
    expect((r.reasons ?? []).join("\n")).toMatch(/耗时 \d+ms/);
  });

  it("成功记录不触发告警——一次正常发布不该发 Telegram", async () => {
    callDeepSeek.mockImplementation(modelWithTranslation());
    await runDailyBriefing(NOW);
    expect(alertBriefing).not.toHaveBeenCalled();
  });

  it("结果与原因写进 admin_settings，供无人值守时段事后查", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    await runDailyBriefing(NOW);
    expect(db.lastRun?.status).toBe("fallback");
    expect(db.lastRun?.reasons.join("\n")).toContain("调用失败");
  });

  // 稳定性审查第 3 号发现：skipped 早退带着空 reasons，写进去会把真正干过活的
  // 那次运行的原因清掉——而覆盖它的往往正是操作者点「立即生成」想查原因的那一下
  it("skipped 不覆盖上一次真实运行的诊断", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    await runDailyBriefing(NOW);
    const recorded = db.lastRun;
    expect(recorded?.status).toBe("fallback");

    // 今天已有稿（刚插入的兜底稿），再点一次 → skipped
    db.existingArticle = { id: "a1" };
    const r2 = await runDailyBriefing(NOW);
    expect(r2.status).toBe("skipped");
    // 诊断仍是那次 fallback 的，没有被空记录冲掉
    expect(db.lastRun).toBe(recorded);
  });

  it("窗口外的 idle 早退同样不覆盖诊断", async () => {
    callDeepSeek.mockResolvedValue(FAIL);
    await runDailyBriefing(NOW);
    const recorded = db.lastRun;

    const r2 = await runDailyBriefing(MIDNIGHT_UTC8);
    expect(r2.status).toBe("skipped");
    expect(db.lastRun).toBe(recorded);
  });

  // 稳定性审查第 7 号发现：推送跑在预算尾巴上且对单端点无超时，
  // 心跳与诊断必须在推送**之前**落定——被平台掐断时损失的只能是推送
  it("推送抛出时心跳与诊断都已写好，文章照常发布", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    db.pushEnabled = true;
    getOptedInSubscriptions.mockRejectedValue(new Error("push infra down"));

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
    expect(db.beats).toContain("ok");
    expect(db.lastRun?.status).toBe("published");
  });

  it("诊断落库失败不影响已经发布成功的文章", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    const r = await runDailyBriefing(NOW);
    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
  });
});

describe("runDailyBriefing — 强制重跑", () => {
  it("force 会先删掉今天那篇再重新生成", async () => {
    db.existingArticle = { id: "a1" };
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    const r = await runDailyBriefing(NOW, { force: true });
    expect(db.deletedSlugs).toEqual(["daily-briefing-2026-08-08"]);
    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
  });

  it("不传 force 时不会删任何东西", async () => {
    db.existingArticle = { id: "a1" };
    await runDailyBriefing(NOW);
    expect(db.deletedSlugs).toEqual([]);
  });

  // 删除推迟到新稿内容就绪之后——早删的话，生成中途任何失败都会让当天从
  // 「有一篇稿」变成「一篇都没有」，而操作者只是点了个「重新生成」。
  it("删除失败时判为 failed，旧稿原封不动、不会落新库", async () => {
    db.existingArticle = { id: "a1" };
    db.deleteError = { message: "permission denied" };
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    const r = await runDailyBriefing(NOW, { force: true });
    expect(r.status).toBe("failed");
    // 生成先于删除发生（这是新语义的代价），但绝不能写进库
    expect(db.inserted).toHaveLength(0);
    // 旧稿还在——删除失败时它没有被动过
    expect(db.existingArticle).toEqual({ id: "a1" });
    expect(db.beats).toContain("error");
  });

  it("force 生成中途失败时，旧稿保留——删除从未发生", async () => {
    db.existingArticle = { id: "a1" };
    // RSS 与行情全挂：L5，连兜底稿都出不了
    fetchBriefingSources.mockResolvedValue([]);
    fetchMarketFacts.mockResolvedValue([]);
    const r = await runDailyBriefing(NOW, { force: true });
    expect(r.status).toBe("failed");
    expect(db.deletedSlugs).toEqual([]);
    expect(db.existingArticle).toEqual({ id: "a1" });
  });
});

// ── C3：一语失败时的翻译通道 ──
describe("runDailyBriefing — L3 翻译通道", () => {
  /**
   * ── 通道顺序：模型是主路，免费端点是备胎 ──
   *
   * 这组用例钉住的是英文版反复降级的**根因**修复。此前英文唯一的来源是
   * translate.googleapis.com 的 gtx 端点：无鉴权、免费，Google 对数据中心 IP 段
   * 整体拦截，命中即 HTTP 429 且**与请求频率无关**（本地复现：间隔 1.5 秒的单条
   * 串行请求同样条条 429）。Vercel 的 serverless 出口正是这类 IP，所以只要落进
   * 被封的段，英文当天必然掉零 AI 兜底稿，重试、降并发、加退避一概无效。
   */
  it("免费翻译端点整段 429 时，英文照样出 AI 稿——这正是线上反复降级的那一天", async () => {
    callDeepSeek.mockImplementation(modelWithTranslation());
    // 端点对每一条都返回失败，模拟 IP 被封
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    const en = db.inserted[0].content["en-US"];
    // 不含兜底稿的小标题 = 走的是 AI 稿而不是零 AI 兜底稿
    expect(en).not.toContain("24-Hour News Roundup");
    expect(en).toContain("Market Read");
    expect(CJK_RE.test(en)).toBe(false);
  });

  it("模型翻译成功时根本不去打免费端点", async () => {
    callDeepSeek.mockImplementation(modelWithTranslation());
    await runDailyBriefing(NOW);
    expect(translateText).not.toHaveBeenCalled();
  });

  it("模型翻译失败时回落到免费端点，而不是直接兜底", async () => {
    // 翻译 prompt 一律失败，生成 prompt 正常
    callDeepSeek.mockImplementation(async (opts) =>
      isTranslatePrompt(opts) ? FAIL : ok(ZH_JSON)
    );
    translateText.mockImplementation(realisticTranslator());

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    expect(translateText).toHaveBeenCalled();
    expect(db.inserted[0].content["en-US"]).toContain("Market Read");
    // 主路失败必须留下痕迹，否则「一直靠备胎兜着」是看不见的
    expect((r.reasons ?? []).join(" | ")).toContain("翻译主路未成");
  });

  it("两条通道都失败才落兜底稿，诊断里两条原因都在", async () => {
    callDeepSeek.mockImplementation(async (opts) =>
      isTranslatePrompt(opts) ? { ok: false, error: "HTTP 402 余额不足" } : ok(ZH_JSON)
    );
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    const log = (r.reasons ?? []).join(" | ");
    // 「今天为什么又降级了」必须能一眼看完，不用去翻 Sentry
    expect(log).toContain("模型翻译");
    expect(log).toContain("HTTP 402");
    expect(log).toContain("翻译端点");
    expect(log).toMatch(/翻译端点失败 (\d+)\/\1 字段/);
  });

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

  // 线上真实事故：模型从抓到的正文里读出「长期价格或达150万美元」（中文没有 $
  // 符号，躲过了 checkHeadlineNumbers）；译成英文后是 "$1,500,000"，触发检查却
  // 找不到匹配——run.ts 在重新过门槛时传的是不含正文的外层 sources，而不是
  // 带正文的 withBodies。已经翻译好、内容完全正确的英文版因此被错判为编造，
  // 整篇降级成兜底稿。这条测试钉住 run.ts 传给「翻译后重新过门槛」那次调用的
  // 必须是带 body 的那份 sources，而不仅仅是 quality-gate 自身认不认 body
  // （那部分已由 quality-gate.test.ts 单独覆盖）。
  it("要闻里只出现在正文（body）中的数字，翻译后重新过门槛时必须认得出来", async () => {
    const bodySource: BriefingSource = {
      title: "Bitwise CIO sees trillions flowing into Bitcoin over the next decade",
      url: "https://e.com/bitwise",
      source: "CoinDesk",
      publishedAt: 1,
      // 摘要里没有具体数字——数字只埋在正文里
      summary: "The Bitwise CIO discussed long-term institutional demand for Bitcoin.",
    };
    // 把这条含正文数字的来源换进本次的来源列表，排在最前面，确保在
    // MAX_SOURCES_IN_PROMPT 的截断范围内
    fetchBriefingSources.mockResolvedValueOnce([bodySource, ...SOURCES.slice(0, 39)]);
    fetchArticleBodies.mockImplementation(async (sources: BriefingSource[]) =>
      sources.map((s) =>
        s.url === bodySource.url
          ? {
              ...s,
              body: "Speaking on a podcast, the Bitwise CIO said trillions of dollars in institutional capital could flow into Bitcoin over the next decade, with the long-term price potentially reaching $1.5 million per coin.",
            }
          : { ...s, body: "" }
      )
    );

    const bigNumberPoint = "某分析师预计比特币长期有望触及150万美元。";
    const zhWithBigNumber: BriefingJson = {
      ...ZH_JSON,
      headlines: ZH_JSON.headlines.map((h, i) =>
        i === 0 ? { ...h, points: [...h.points, bigNumberPoint] } : h
      ),
    };
    // 只需生成中文——新设计下 en-US 永远走翻译，不再原生调用
    callDeepSeek.mockResolvedValue(ok(zhWithBigNumber));

    translateText.mockImplementation(async (text: string) =>
      text === bigNumberPoint
        ? "One analyst expects Bitcoin to eventually reach $1,500,000 over the long term."
        : fakeEnglish(text)
    );

    await runDailyBriefing(NOW);

    const article = db.inserted[0];
    expect(article).toBeDefined();
    expect(article.content["en-US"]).toContain("$1,500,000");
    // 不含「24-Hour News Roundup」= 没有降级成零 AI 兜底稿
    expect(article.content["en-US"]).not.toContain("24-Hour News Roundup");
  });

  it("翻译走的是字段而不是整篇 HTML——小标题与括号样式都被正确本地化", async () => {
    callDeepSeek.mockImplementation(async (opts) => (isEnglishPrompt(opts) ? FAIL : ok(ZH_JSON)));
    translateText.mockImplementation(realisticTranslator());

    await runDailyBriefing(NOW);
    const en = db.inserted[0].content["en-US"];
    // 小标题是渲染器按 locale 产出的，不是翻译器翻出来的——它们出现即证明
    // 走的是「翻字段 → 重新渲染」，而不是把整篇 HTML 丢进翻译器
    expect(en).toContain("Market Read");
    expect(en).toContain("Last 24 Hours");
    expect(en).toContain("Market Snapshot");
    expect(en).toContain("(24h +0.92%)");
    expect(en).not.toContain("（");
    // 价格不经过翻译器，原样保留
    expect(en).toContain("$64,959.52");
    // HTML 整篇没有被丢进翻译器
    for (const call of translateText.mock.calls) {
      expect(call[0]).not.toContain("<");
    }
  });

  it("翻译失败时落到兜底稿，绝不把中文正文当成 en-US 发布", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    translateText.mockResolvedValue(null);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(CJK_RE.test(db.inserted[0].content["en-US"])).toBe(false);
    const messages = alertBriefing.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("翻译失败"))).toBe(true);
    // 绝不能出现谎报成功的告警
    expect(messages.some((m) => m.includes("兜住"))).toBe(false);
    // 中文 AI 稿必须保住——翻译失败不该连累已经过了门槛的那一语
    expect(db.inserted[0].content["zh-CN"]).toContain("市场解读");
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

  it("主语言生成失败时两语都用兜底稿——没有可翻译的原文", async () => {
    callDeepSeek.mockResolvedValue(FAIL);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    const a = db.inserted[0];
    expect(a.title["zh-CN"]).toContain("24 小时要闻速览");
    expect(a.title["en-US"]).toContain("24-Hour News Roundup");
    expect(a.content["zh-CN"]).not.toContain("市场解读");
    // 主语言都没出来就不该再去调翻译
    expect(translateText).not.toHaveBeenCalled();
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
      // 40 次 = 319 字符，越过英文的 titleMax(260)。这个倍数随阈值走：
      // 上限每次上调，这里的构造长度都得跟着抬，否则夹具落回合法区间、
      // 测试静默失效——它已经因为这个原因改过两次了。
      text === ZH_JSON.title ? "Bitcoin ".repeat(40).trim() : fakeEnglish(text)
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

  // 旧的两语并发版本靠 allSettled 得到「生成抛出 -> 降级而非整轮失败」这个性质。
  // 改成单次生成后必须显式补回来，否则一次意外抛出就是今天一篇都没有。
  it("生成过程抛出异常时降级成兜底稿，并把原因告警出来", async () => {
    callDeepSeek.mockImplementation(async () => {
      throw new Error("kaboom");
    });

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(db.inserted).toHaveLength(1);
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
  // 并**绕过**兜底稿。现在这类「只是多包了一层」的漂移在解析阶段就被展平——
  // 语义本来就是完整的，为它烧掉一次模型调用不值得（线上 2026-08-10 的第二次
  // 生成正是死在这上面）。要守住的仍然是同一件事：不许崩。
  it("模型吐出对象型 watchlist 时展平后照常出稿，不崩成 failed", async () => {
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
    expect(r.status).not.toBe("failed");
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].content["zh-CN"]).toContain("关注美联储：本周讲话");
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
describe("常量之间必须自洽", () => {
  it("一次完整生成装得进流水线预算", async () => {
    const { PIPELINE_BUDGET_MS } = await import("./run");
    const { DEFAULT_TIMEOUT_MS } = await import("./deepseek");
    expect(DEFAULT_TIMEOUT_MS).toBeLessThan(PIPELINE_BUDGET_MS);
  });

  it("重试门槛不低于一次生成的耗时——否则重试注定超时，只是白烧预算", async () => {
    const { MIN_CALL_BUDGET_MS } = await import("./run");
    // 实测：22 秒不够一次生成。门槛必须至少是这个量级，否则「还剩十几秒，
    // 再试一次」永远不可能成功。
    expect(MIN_CALL_BUDGET_MS).toBeGreaterThanOrEqual(20_000);
  });
});

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
    // 预算 48s，单次超时 34s，重试门槛 20s：只生成主语言，第一次跑满 34s 后
    // 只剩 14s，低于门槛，不再发起注定超时的第二次，直接落到 L4。
    // 这正是实测教训——用 14 秒去做一件要 30 秒的事，只会把剩余预算也烧掉。
    expect(elapsed).toBeLessThan(48_000);
    expect(callDeepSeek.mock.calls.length).toBe(1);
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
      expect(call[0].timeoutMs).toBeLessThanOrEqual(34_000);
    }
  });
});

// ── I4：发布时间窗 ──
describe("runDailyBriefing — 发布时间窗", () => {
  it("UTC+8 半夜的 tick 直接 skipped，不出稿", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
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
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));

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
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
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

describe("runDailyBriefing — Telegram 早报推送", () => {
  it("发布成功后把当天 slug 与双语标题交给 Telegram 推送", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));

    await runDailyBriefing(NOW);

    expect(pushBriefingToTelegram).toHaveBeenCalledTimes(1);
    const [slug, titles] = pushBriefingToTelegram.mock.calls[0];
    expect(slug).toBe("daily-briefing-2026-08-08");
    // 传的必须是落库那份标题，否则 Telegram 里的标题和站上那篇对不上
    expect(titles["zh-CN"]).toBe(db.inserted[0].title["zh-CN"]);
    expect(titles["en-US"]).toBe(db.inserted[0].title["en-US"]);
  });

  // 文章此时已经落库、心跳也写完了。一条链接发不出去绝不能把整轮判成失败——
  // 那会让运维以为今天没出稿，而稿子明明在站上。
  it("推送抛出时文章照常算发布成功", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    pushBriefingToTelegram.mockRejectedValue(new Error("telegram down"));

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("published");
    expect(db.inserted).toHaveLength(1);
    expect(db.beats).toContain("ok");
  });

  it("部分目标失败时把失败目标写进诊断，供后台事后排查", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    pushBriefingToTelegram.mockResolvedValue({
      results: [
        { label: "主频道", ok: true },
        { label: "内部群", ok: false, error: "chat not found" },
      ],
    });

    await runDailyBriefing(NOW);

    const reasons = (db.lastRun?.reasons ?? []).join("\n");
    expect(reasons).toContain("1/2 个目标成功");
    expect(reasons).toContain("内部群: chat not found");
  });

  // 线上第一次真跑就撞上的回归：三次生成累计 33 秒（前两次没过质量门槛），
  // 推送阶段看到「距 48 秒终点只剩 8.4 秒」就跳过了——而那 12 秒的尾巴本来
  // 就是留给投递的，拿生成阶段的终点去卡它等于把预留扣了两遍。
  it("生成吃掉大半个流水线预算后，链接照样推得出去", async () => {
    vi.useFakeTimers();
    // 40 秒：距 PIPELINE_BUDGET_MS(48s) 终点只剩 8s，低于 9s 的推送门槛；
    // 而距 DELIVERY_BUDGET_MS(54s) 终点还有 14s，绰绰有余。
    callDeepSeek.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40_000));
      return ok(ZH_JSON);
    });

    const pending = runDailyBriefing(NOW);
    await vi.runAllTimersAsync();
    const r = await pending;

    expect(r.status).toBe("published");
    expect(pushBriefingToTelegram).toHaveBeenCalledTimes(1);
  });

  // 链接只能发一次。兜底稿发出去等于把读者领到一篇待会儿就要被升级重试
  // 替换掉的稿子前面，而那时已经没有第二次机会了。
  it("兜底稿不立即推链接，留给升级重试", async () => {
    callDeepSeek.mockResolvedValue(FAIL);

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("fallback");
    expect(pushBriefingToTelegram).not.toHaveBeenCalled();
    // 不是放弃，是交给补投——诊断里必须说清楚，否则看起来就是又丢了一条
    expect((db.lastRun?.reasons ?? []).join("\n")).toContain("暂不推送");
  });

  it("正常 AI 稿是定稿，立即推链接", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
    await runDailyBriefing(NOW);
    expect(pushBriefingToTelegram).toHaveBeenCalledTimes(1);
  });

  it("今天已有稿而早退时不推送——否则同一条链接每个 tick 发一次", async () => {
    db.existingArticle = { id: "a1" };
    await runDailyBriefing(NOW);
    expect(pushBriefingToTelegram).not.toHaveBeenCalled();
  });

  it("窗口外的 tick 不推送", async () => {
    await runDailyBriefing(MIDNIGHT_UTC8);
    expect(pushBriefingToTelegram).not.toHaveBeenCalled();
  });
});

// 一天只跑一次的流水线里，「今天降级了」是个无法挽回的既成事实。发布窗口
// 还有几小时、还有几十次 tick，就该再试——但每一步都不能让读者手里那篇变少。
describe("runDailyBriefing — 兜底稿升级重试", () => {
  const SLUG = "daily-briefing-2026-08-08";

  it("今天是兜底稿时重新生成，成功后替换旧稿", async () => {
    db.existingArticle = { id: "a1" };
    db.publishState = { slug: SLUG, degraded: true, attempts: 0 };
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));

    const r = await runDailyBriefing(NOW, { upgradeFallback: true });

    expect(r.status).toBe("published");
    expect(db.deletedSlugs).toEqual([SLUG]);
    expect(db.inserted).toHaveLength(1);
    expect(db.publishState).toMatchObject({ degraded: false, attempts: 1 });
  });

  // 这一轮又只出得了兜底稿的话，替换没有任何意义：内容同样没有 AI 判断，
  // 却白白多一次删除+插入、一次缓存失效，还把 published_at 往后推。
  it("升级又只出兜底稿时不替换，旧稿一个字不动", async () => {
    db.existingArticle = { id: "a1" };
    db.publishState = { slug: SLUG, degraded: true, attempts: 0 };
    callDeepSeek.mockResolvedValue(FAIL);

    const r = await runDailyBriefing(NOW, { upgradeFallback: true });

    expect(r.status).toBe("skipped");
    expect(db.deletedSlugs).toEqual([]);
    expect(db.inserted).toHaveLength(0);
    // 次数要记上，否则永远试不完
    expect(db.publishState).toMatchObject({ degraded: true, attempts: 1 });
  });

  // 封顶：连着几轮都只能出兜底稿，说明问题不在偶发抖动，再试也是同样结果——
  // 而每一次都是真金白银的模型调用
  it("次数用完后不再重新生成", async () => {
    db.existingArticle = { id: "a1" };
    db.publishState = { slug: SLUG, degraded: true, attempts: 3 };

    const r = await runDailyBriefing(NOW, { upgradeFallback: true });

    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it("已经是 AI 正常稿时不会被重新生成", async () => {
    db.existingArticle = { id: "a1" };
    db.publishState = { slug: SLUG, degraded: false, attempts: 0 };

    const r = await runDailyBriefing(NOW, { upgradeFallback: true });

    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it("不传 upgradeFallback 时维持原来的幂等早退", async () => {
    db.existingArticle = { id: "a1" };
    db.publishState = { slug: SLUG, degraded: true, attempts: 0 };

    const r = await runDailyBriefing(NOW);

    expect(r.status).toBe("skipped");
    expect(callDeepSeek).not.toHaveBeenCalled();
  });
});

describe("runDailyBriefing — 推送分组", () => {
  it("订阅行的 locale 为 null 时回落到 en-US，链接不会变成 /undefined/", async () => {
    callDeepSeek.mockResolvedValue(ok(ZH_JSON));
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
