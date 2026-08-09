import { describe, it, expect } from "vitest";
import { extractPrices, extractPercents, parseBriefingJson, checkBriefing } from "./quality-gate";
import { MAX_SOURCES_IN_PROMPT } from "./prompt";
import type { BriefingJson, MarketFact, BriefingSource } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "ETH-USDT", label: "ETH", lastPrice: 1914.99, change24hPct: 0.59 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: 1.37 },
];

const SOURCES: BriefingSource[] = [
  { title: "美国 CPI 同比 3.1%", url: "https://e.com/1", source: "CNBC", publishedAt: 0, summary: "" },
];

// 夹具的每段长度都必须真的越过阈值，否则基线用例自己就过不了门槛。
// 实测（[...s].length）：overview 111 / crypto 109 / gold 100，正文合计 430，
// 三者均在 SECTION_MIN=80..SECTION_MAX=600 内，正文高于 BODY_MIN=400 共 30 字余量。
// 各用例替换的子串（$64,959.52、0.92%、1.37%）长度中性，替换后不会跌破阈值。
function validJson(over: Partial<BriefingJson> = {}): BriefingJson {
  return {
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
      gold:
        "黄金代币 XAUT 报 $4,325.51，二十四小时上涨 1.37%，明显强于同期加密资产，显示避险需求仍在累积。这与近期宏观不确定性上升的背景一致，后续值得留意其与实际利率之间的关系是否继续背离。",
      watchlist: ["关注美联储官员本周的公开讲话", "关注黄金能否站稳当前阶段高位"],
    },
    ...over,
  };
}

function check(json: unknown, finishReason: string | null = "stop") {
  return checkBriefing({ json, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason });
}

// ── 英文路径的夹具 ──
// 事实集用真实的 8 标的形态（含 SOL），因为 C1 的误绑正是 SOL 造成的：
// con[SOL]idation / [SOL]id 是行情文案的高频词。
const EN_FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "ETH-USDT", label: "ETH", lastPrice: 1914.99, change24hPct: 0.59 },
  { symbol: "SOL-USDT", label: "SOL", lastPrice: 132.4, change24hPct: -2.11 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: 1.37 },
];

function validJsonEn(over: Partial<BriefingJson> = {}): BriefingJson {
  return {
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
    ...over,
  };
}

function checkEn(json: unknown, finishReason: string | null = "stop") {
  return checkBriefing({ json, facts: EN_FACTS, sources: SOURCES, locale: "en-US", finishReason });
}

describe("extractPrices", () => {
  it("抽取带 $ 与千分位的价格", () => {
    expect(extractPrices("BTC 报 $64,959.52 上行")).toEqual([64959.52]);
  });
  it("抽取多个价格", () => {
    expect(extractPrices("$1,000 与 $2.5")).toEqual([1000, 2.5]);
  });
  it("不把裸数字当价格", () => {
    expect(extractPrices("2026 年 8 月 8 日，共 12 条")).toEqual([]);
  });
});

describe("extractPercents", () => {
  it("抽取正负百分比", () => {
    expect(extractPercents("上涨 0.92%，下跌 -1.5%")).toEqual([0.92, -1.5]);
  });
  it("无百分比时返回空", () => {
    expect(extractPercents("没有数字")).toEqual([]);
  });
});

describe("parseBriefingJson", () => {
  it("解析裸 JSON", () => {
    expect(parseBriefingJson('{"title":"t"}')).toEqual({ title: "t" });
  });
  it("解析被 ```json 围栏包裹的输出", () => {
    expect(parseBriefingJson('```json\n{"title":"t"}\n```')).toEqual({ title: "t" });
  });
  it("空字符串返回 null（DeepSeek 文档明示会偶发空内容）", () => {
    expect(parseBriefingJson("")).toBeNull();
  });
  it("非法 JSON 返回 null", () => {
    expect(parseBriefingJson("{not json")).toBeNull();
  });
});

describe("checkBriefing", () => {
  it("合格稿通过", () => {
    expect(check(validJson()).ok).toBe(true);
  });

  it("finish_reason 为 length 判定截断", () => {
    const r = check(validJson(), "length");
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "truncated")).toBe(true);
  });

  it("缺字段判定结构不完整", () => {
    const r = check({ title: "t" });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("headlines 少于 2 个主题不通过", () => {
    const r = check(validJson({ headlines: [{ topic: "加密货币", points: ["a"] }] }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("标题过短不通过", () => {
    const r = check(validJson({ title: "早报" }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("编造的价格被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$99,999.00");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("价格在 ±0.5% 容差内视为正确（允许模型四舍五入）", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$65,000.00");
    expect(check(j).ok).toBe(true);
  });

  it("编造的涨跌幅被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "7.50%");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("涨跌幅在 ±0.2 个百分点内视为正确", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "1.00%");
    expect(check(j).ok).toBe(true);
  });

  it("headlines 里来自新闻的百分比不参与核对（避免误报）", () => {
    const j = validJson();
    j.headlines[0].points.push("美国 CPI 同比 3.1%");
    expect(check(j).ok).toBe(true);
  });

  it("analysis 中引用源文里出现过的数字不算编造", () => {
    const j = validJson();
    j.analysis.overview += "市场消化了 3.1% 的通胀读数，情绪趋于稳定，短期内仍以震荡为主。";
    expect(check(j).ok).toBe(true);
  });

  // ── 标的邻近绑定：以下两条各自复现一个曾能击穿门槛的真实场景 ──

  // 两个数字都仍在事实集里，只是安到了错的标的上——这正是旧实现全部放行的场景
  it("换标的被抓出：BTC 段落写成黄金的数字", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto
      .replace("$64,959.52", "$4,325.51")
      .replace("0.92%", "1.37%");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("换标的被抓出：黄金段落写成 BTC 的数字", () => {
    const j = validJson();
    j.analysis.gold = j.analysis.gold
      .replace("$4,325.51", "$64,959.52")
      .replace("1.37%", "0.92%");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("绑定到标的后，来源白名单不能替伪造数字背书", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "7.50%");
    // 当天恰好有一条无关新闻里出现同一个数字——它不该让 BTC 段的伪造过关
    const noisySources: BriefingSource[] = [
      ...SOURCES,
      { title: "iPhone 出货量下降 7.50%", url: "https://e.com/2", source: "CNBC", publishedAt: 0, summary: "" },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: noisySources, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("同句内有多个标签时绑定最近的那个", () => {
    const j = validJson();
    j.analysis.overview =
      "回顾昨日整体走势，BTC 与以太坊双双走高，其中 ETH 报 $1,914.99，表现稳健且波动收敛，市场情绪整体偏向乐观，成交量也较前一个交易日温和放大，显示资金仍留在场内观望而非离场。";
    expect(check(j).ok).toBe(true);
  });

  // ── 量级后缀：线上第一次真跑就栽在这里 ──
  // 源文标题「Bitcoin will never fall below $60K again」被模型如实引用成
  // $60,000，而白名单只提取到 60，于是把一句忠实转述判成编造，整篇 zh-CN
  // 被打回、最终降级成零 AI 兜底稿。
  it("源文写 $60K、模型展开成 $60,000 时不算编造", () => {
    const j = validJson();
    j.analysis.overview += "有观点认为比特币不会再跌破 $60,000，这一判断仍待验证。";
    const withK: BriefingSource[] = [
      ...SOURCES,
      {
        title: "Bitcoin will never fall below $60K again: Nansen founder",
        url: "https://e.com/60k",
        source: "Cointelegraph",
        publishedAt: 0,
        summary: "",
      },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: withK, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("源文没提过的量级数字仍然算编造", () => {
    const j = validJson();
    j.analysis.overview += "有观点认为比特币不会再跌破 $30,000，这一判断仍待验证。";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("百万/十亿级后缀同样能对上", () => {
    const j = validJson();
    j.analysis.overview += "报道称该基金规模达 $240,000,000,000，为业内罕见。";
    const withB: BriefingSource[] = [
      ...SOURCES,
      {
        title: "Millennium Manages $240 Billion Across Thousands of Positions",
        url: "https://e.com/240b",
        source: "Yahoo Finance",
        publishedAt: 0,
        summary: "",
      },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: withB, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  // ── 长度阈值按语言分开：线上第二个卡点 ──
  // 阈值原本只有一套、按中文定，却拿去量英文。同一篇稿子英译后标题 127 字符、
  // 段落 695/740 字符，全部超限，正确的译文被系统性打回、英文版天天降级。
  it("同样长度的英文稿在中文尺子下超标，在英文尺子下合格", () => {
    const en: BriefingJson = {
      title: "Daily Briefing | Bitcoin steadies near sixty five thousand as gold tokens hold their recent gains",
      summary:
        "Risk assets and gold tokens both firmed over the past twenty four hours, with macro expectations still unsettled ahead of the inflation print.",
      headlines: [
        { topic: "Crypto", points: ["Bitcoin held its range through Asian hours as spot demand stayed steady"] },
        { topic: "Gold", points: ["Gold tokens pushed higher on continued haven demand across the region"] },
      ],
      analysis: {
        overview:
          "Risk assets and safe havens advanced together over the past twenty four hours, which usually signals ample liquidity rather than a directional bet. That combination tends to appear when macro expectations have not yet converged, leaving participants unwilling to abandon either side of the book while they wait for clearer policy guidance from officials.",
        crypto:
          "Bitcoin changed hands around sixty five thousand dollars, a mild advance that did not come with unusual volume. Order flow showed no concentrated release of buying interest, so the prevailing range remains intact and it is too early to call a change in trend without several more sessions of confirmation.",
        gold:
          "Gold tokens outperformed crypto assets over the same window, suggesting hedging demand is still accumulating. That is consistent with the recent rise in macro uncertainty, and it is worth watching whether the relationship with real yields continues to diverge in the sessions ahead.",
        watchlist: ["Watch for Federal Reserve commentary this week", "Watch whether gold holds its recent range"],
      },
    };
    // 英文尺子：通过
    expect(
      checkBriefing({ json: en, facts: FACTS, sources: SOURCES, locale: "en-US", finishReason: "stop" }).ok
    ).toBe(true);
    // 同一篇拿中文尺子量：会因超长被拒——这正是线上发生的事
    const asZh = checkBriefing({
      json: en, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason: "stop",
    });
    expect(asZh.failures.some((f) => f.rule === "length")).toBe(true);
  });

  // ── 正文侧的量级后缀：线上第三个卡点 ──
  // 源文 "$1B inflows" 译成 "$1 billion"，价格提取只读到 $1，判成编造。
  it("要闻里的 $1 billion 能和源文的 $1B 对上", () => {
    const j = validJson();
    j.headlines[0].points.push("美国现货比特币 ETF 上周净流入 $1 billion，创四月以来最佳表现。");
    const withB: BriefingSource[] = [
      ...SOURCES,
      {
        title: "US spot Bitcoin ETFs post best week since April with $1B inflows",
        url: "https://e.com/etf",
        source: "Cointelegraph",
        publishedAt: 0,
        summary: "",
      },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: withB, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("要闻里源文没提过的量级价格仍算编造", () => {
    const j = validJson();
    j.headlines[0].points.push("某基金单周净流入 $9 billion，规模空前。");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("禁用表述被抓出", () => {
    const j = validJson();
    j.analysis.watchlist = ["建议买入 BTC"];
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("英文禁用表述同样被抓出", () => {
    const j = validJson();
    j.analysis.overview = "We recommend buying now. " + j.analysis.overview;
    const r = checkBriefing({
      json: j, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("中文稿写成英文被判语言串台", () => {
    const j = validJson({
      summary: "Over the past twenty four hours the market moved higher across the board today.",
    });
    j.analysis.overview =
      "Over the past twenty four hours risk assets and safe havens both advanced, which usually happens when macro expectations have not converged and market participants are waiting for clearer guidance from policymakers.";
    j.analysis.crypto =
      "Bitcoin traded at sixty four thousand and change over the session, with a mild advance that did not come with unusual volume, so the range remains intact for now and needs confirmation.";
    j.analysis.gold =
      "Gold tokens extended their advance during the period, outperforming crypto assets and signalling that hedging demand is still present across the broader market today.";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "language")).toBe(true);
  });

  it("分析段落过短不通过", () => {
    const j = validJson();
    j.analysis.overview = "涨了。";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("null 输入不抛错，判定结构不完整", () => {
    const r = check(null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  // ── I5：headlines 里带 $ 的价格做一次宽松核对 ──
  it("headlines 里伪造的价格被抓出", () => {
    const j = validJson();
    j.headlines[0].points.push("比特币突破 $70,000 创下阶段新高");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("要闻中的价格"))).toBe(true);
  });

  it("headlines 里与事实集吻合的价格放行", () => {
    const j = validJson();
    j.headlines[0].points.push("比特币报 $64,959.52，日内波动收敛");
    expect(check(j).ok).toBe(true);
  });

  it("headlines 里的价格出现在源文中即放行——源文写法可以不带 $", () => {
    const j = validJson();
    j.headlines[2].points.push("特斯拉股价跌破 $300");
    const noisySources: BriefingSource[] = [
      ...SOURCES,
      { title: "Tesla slips below 300 in premarket", url: "https://e.com/t", source: "CNBC", publishedAt: 0, summary: "" },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: noisySources, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("模型把源文的价格做了正常四舍五入时不算伪造", () => {
    const j = validJson();
    j.headlines[2].points.push("某标的报 $70,000 附近");
    const noisySources: BriefingSource[] = [
      ...SOURCES,
      { title: "Index prints $69,999 at the close", url: "https://e.com/i", source: "CNBC", publishedAt: 0, summary: "" },
    ];
    const r = checkBriefing({
      json: j, facts: FACTS, sources: noisySources, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("headlines 里的百分比仍然完全不核对（误报率最高的一类）", () => {
    const j = validJson();
    j.headlines[0].points.push("某国失业率降至 3.9%，非农超预期");
    expect(check(j).ok).toBe(true);
  });

  // ── I2：结构合法但元素类型漂移 ──
  // 这类输出曾能通过门槛（join 把对象变成 "[object Object]"，长度也够），
  // 然后在 render.ts 的 escapeHtml 里抛 TypeError，把整轮打成 failed 且
  // 绕过 L4 兜底稿。必须在门槛这一层拒掉，让它走重试与优雅降级。
  it("watchlist 元素是对象时判定结构不完整（否则渲染器会崩溃并绕过兜底稿）", () => {
    const j = validJson();
    (j.analysis as { watchlist: unknown }).watchlist = [
      { title: "关注美联储", detail: "本周讲话" },
      { title: "关注黄金", detail: "能否站稳" },
    ];
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("headlines.points 元素是对象时判定结构不完整", () => {
    const j = validJson();
    (j.headlines[0] as { points: unknown }).points = [{ text: "比特币震荡" }];
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("watchlist 含空串同样判定结构不完整", () => {
    const j = validJson();
    j.analysis.watchlist = ["关注美联储官员本周的公开讲话", "   "];
    expect(check(j).ok).toBe(false);
  });

  it("被拒的稿子不会被送进渲染器（结构失败即短路，不再跑数字/长度规则）", () => {
    const j = validJson();
    (j.analysis as { watchlist: unknown }).watchlist = [{ title: "x" }];
    const r = check(j);
    expect(r.failures.every((f) => f.rule === "structure")).toBe(true);
  });
});

// ── A：来源比对池的两处收窄 ──
// 白名单的正当性完全建立在「这个数字模型确实读到过」之上。收窄前它取的是全部
// sources（24h 过滤后最多 200 条，模型只看前 40 条），而 BARE_NUMBER_RE 切出来的
// 是片段（2026-08-08 → 2026/8/8，14:30 → 14/30），小整数每天都会把白名单塞满。
describe("checkBriefing — 来源比对池", () => {
  function src(title: string): BriefingSource {
    return { title, url: "https://e.com/x", source: "CNBC", publishedAt: 0, summary: "" };
  }
  /** 正好 MAX_SOURCES_IN_PROMPT 条不含任何数字的占位来源 */
  const FILLER: BriefingSource[] = Array.from({ length: MAX_SOURCES_IN_PROMPT }, (_, i) =>
    src(`Neutral market wrap ${String.fromCharCode(97 + (i % 26))}`)
  );

  it("排在第 41 条的来源不能替 headlines 里的价格背书（模型根本没看过它）", () => {
    const j = validJson();
    j.headlines[2].points.push("某标的报 $70,000 附近");
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: [...FILLER, src("Index prints 69,999 at the close")],
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("要闻中的价格"))).toBe(true);
  });

  it("同一条来源排进前 40 条时照常放行", () => {
    const j = validJson();
    j.headlines[2].points.push("某标的报 $70,000 附近");
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: [src("Index prints 69,999 at the close"), ...FILLER],
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("analysis 的来源白名单同样只认模型看过的那 40 条", () => {
    const j = validJson();
    j.analysis.overview += "市场消化了 3.1% 的通胀读数，情绪趋于稳定，短期内仍以震荡为主。";
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: [...FILLER, src("US CPI came in at 3.1% year over year")],
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("日期与时间切出来的小整数不再进白名单", () => {
    const j = validJson();
    j.headlines[2].points.push("某标的报 $14 附近");
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      // 2026-08-08 与 14:30 会被 BARE_NUMBER_RE 切成 2026/8/8/14/30
      sources: [src("Filed 2026-08-08 14:30, no price in the headline"), ...FILLER],
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("要闻中的价格"))).toBe(true);
  });

  it("三位及以上的数字仍然放行——300 与 69,999 这两个正例不受影响", () => {
    const j = validJson();
    j.headlines[2].points.push("特斯拉股价跌破 $300，某指数报 $70,000");
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: [src("Tesla slips below 300"), src("Index prints $69,999 at the close"), ...FILLER],
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  // ── 白名单必须扫正文，不能只扫标题/摘要 ──
  // 线上真实栽过：模型从抓到的正文里读出「长期价格或达150万美元」，中文没有
  // $ 符号躲过了检查；译成英文后是「$1,500,000」，触发检查却找不到匹配——
  // 白名单当时只拼了 title + summary，从没读过 body，而这个数字只出现在正文里，
  // 不在 RSS 的标题或摘要中。已通过质量门槛的英文版因此被错误打回兜底稿。
  it("只出现在正文（body）里的数字，白名单也要认——不能只看标题摘要", () => {
    const j = validJson();
    j.headlines[2].points.push("某分析师预计比特币长期有望触及 $1,500,000。");
    const withBody: (BriefingSource & { body?: string })[] = [
      {
        title: "Bitwise CIO sees trillions flowing into Bitcoin over the next decade",
        url: "https://e.com/bitwise",
        source: "CoinDesk",
        publishedAt: 0,
        // RSS 摘要通常很短，不含具体数字——真正的数字埋在正文里
        summary: "The Bitwise CIO discussed long-term institutional demand for Bitcoin.",
        body: "Speaking on a podcast, the Bitwise CIO said trillions of dollars in institutional capital could flow into Bitcoin over the next decade, with the long-term price potentially reaching $1.5 million per coin.",
      },
      ...FILLER,
    ];
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: withBody,
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(true);
  });

  it("同一条来源没有 body 字段时，仍不报错，只是数字会因未在标题摘要中出现而被拒", () => {
    const j = validJson();
    j.headlines[2].points.push("某分析师预计比特币长期有望触及 $1,500,000。");
    // 不带 body：模拟未抓到正文（付费墙/反爬）的常见情形，或旧的 BriefingSource[]
    const noBody: BriefingSource[] = [
      {
        title: "Bitwise CIO sees trillions flowing into Bitcoin over the next decade",
        url: "https://e.com/bitwise",
        source: "CoinDesk",
        publishedAt: 0,
        summary: "The Bitwise CIO discussed long-term institutional demand for Bitcoin.",
      },
      ...FILLER,
    ];
    const r = checkBriefing({
      json: j,
      facts: FACTS,
      sources: noBody,
      locale: "zh-CN",
      finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("要闻中的价格"))).toBe(true);
  });
});

// ── C1 回归：英文散文路径 ──
// 旧实现用 lastIndexOf 做无边界子串匹配，行情文案的高频词会把数字误绑到错标的：
// con[SOL]idation、[SOL]id、wh[ETH]er、tog[ETH]er。终审实测 6 句正常英文散文里
// 4 句被拒，而英文稿说 "Bitcoin"/"gold" 远多于 "BTC"/"XAUT"，真正该赢的标签
// 往往根本不在窗口里。全部 30 个既有用例都是 zh-CN + 中文散文，英文路径零覆盖，
// 这正是 C1 能溜过每一道任务级审查的原因。
describe("checkBriefing — 英文稿路径", () => {
  it("英文合格稿通过（正文含 consolidation 且紧邻正确价格）", () => {
    const j = validJsonEn();
    expect(j.analysis.overview).toContain("consolidation");
    const r = checkEn(j);
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("consolidation 附近的正确 BTC 价格不再被误绑到 SOL", () => {
    const j = validJsonEn();
    j.analysis.overview =
      "Bitcoin is solidly bid, changing hands at $64,959.52 in Asian hours, and the consolidation phase lifted gold tokens as well. Neither move came with unusual volume, so the range still frames the next few sessions rather than a breakout.";
    expect(checkEn(j).ok).toBe(true);
  });

  it("consolidation 附近的源文数字仍走来源白名单（误绑会绕开白名单）", () => {
    const j = validJsonEn();
    // 旧实现：窗口里的 con[SOL]idation 绑到 SOL，随后 continue 跳过来源白名单，
    // 于是这个明明来自当天新闻的 3.1% 被判成编造。
    j.analysis.overview +=
      " The consolidation followed a CPI print of 3.1% that markets had already discounted.";
    expect(checkEn(j).ok).toBe(true);
  });

  it("whether 不再被当成 ETH 标签", () => {
    const j = validJsonEn();
    j.analysis.crypto =
      "It remains unclear whether the bid persists; the pair added 0.92% today while the tape stayed thin. Positioning has not shifted enough to call a trend, and the next inflation print is the obvious catalyst for either side.";
    // 0.92% 是 BTC 的真实涨跌；旧实现会绑到 wh[ETH]er 的 ETH(+0.59%) 而拒稿
    expect(checkEn(j).ok).toBe(true);
  });

  it("英文稿里换标的仍被抓出", () => {
    const j = validJsonEn();
    j.analysis.gold = j.analysis.gold.replace("$4,325.51", "$64,959.52");
    const r = checkEn(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("紧跟标点/括号的标签仍能绑定：BTC, 与 (ETH)", () => {
    const j = validJsonEn();
    j.analysis.crypto =
      "Two majors led the tape today. For BTC, $4,325.51 would be a different market entirely, and the same is true of (ETH) at these levels, so the session stayed range bound with little conviction on either side of the book.";
    const r = checkEn(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("BTC"))).toBe(true);
  });

  it("斜杠分隔的标签仍能绑定：XAUT/PAXG", () => {
    const facts: MarketFact[] = [
      ...EN_FACTS,
      { symbol: "PAXG-USDT", label: "PAXG", lastPrice: 4331.2, change24hPct: 1.43 },
    ];
    const j = validJsonEn();
    j.analysis.gold =
      "The two gold tokens XAUT/PAXG $1,914.99 would imply a market that simply does not exist, which is why the pair remains the cleanest read on haven demand across the whole session and into the following one.";
    const r = checkBriefing({ json: j, facts, sources: SOURCES, locale: "en-US", finishReason: "stop" });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("PAXG"))).toBe(true);
  });

  it("中文稿里紧贴 CJK 的标签仍能绑定", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("BTC 报 $64,959.52", "比特币BTC报 $4,325.51");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.detail.includes("BTC"))).toBe(true);
  });

  it("事实集为空时不绑定任何标的，也不抛错", () => {
    const j = validJsonEn();
    const r = checkBriefing({
      json: j, facts: [], sources: SOURCES, locale: "en-US", finishReason: "stop",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.every((f) => f.rule === "hallucinated-number")).toBe(true);
  });
});
