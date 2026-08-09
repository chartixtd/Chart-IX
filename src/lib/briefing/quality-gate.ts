import { MAX_SOURCES_IN_PROMPT } from "./prompt";
import type { BriefingJson, BriefingLocale, BriefingSource, MarketFact } from "./types";

export interface GateFailure {
  rule: string;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

/** 价格容差：允许模型四舍五入 */
const PRICE_TOLERANCE_RATIO = 0.005;
/** 百分比容差，单位是"个百分点" */
const PERCENT_TOLERANCE_PP = 0.2;
/** 数字回看标的标签的最大字符距离（还会被句子边界进一步截断） */
const LABEL_PROXIMITY_WINDOW = 40;

/**
 * 长度阈值**按语言分开**。
 *
 * 阈值原本只有一套，是按中文定的，却拿去量英文——而同样的内容，英文要多得多的
 * 字符：中文一个字承载的信息约等于英文两到三个字符。线上实测同一篇稿子：
 *   标题   中文 ~30 字   →  英译 127 字符（旧上限 60）
 *   导读   中文 ~80 字   →  英译 225 字符（旧上限 120）
 *   段落   中文 ~250 字  →  英译 695/740 字符（旧上限 600）
 * 译文完全正确，是尺子不对。结果是英文版每天被自己的门槛打回、降级成兜底稿。
 *
 * 英文一侧的数值即由上面这组实测倒推，并留出余量；不是一个拍脑袋的倍率。
 * 正文总长下限同理放大——它防的是「结构齐全但内容稀薄」，与语言无关的是
 * 信息量而不是字符数。
 */
interface LengthLimits {
  titleMin: number;
  titleMax: number;
  summaryMin: number;
  summaryMax: number;
  sectionMin: number;
  sectionMax: number;
  /** 渲染后正文总长下限，用于兜住"结构齐全但内容稀薄"的半截输出 */
  bodyMin: number;
}

const LIMITS: Record<BriefingLocale, LengthLimits> = {
  "zh-CN": {
    titleMin: 10,
    titleMax: 60,
    summaryMin: 20,
    summaryMax: 120,
    sectionMin: 80,
    sectionMax: 600,
    bodyMin: 400,
  },
  "en-US": {
    titleMin: 24,
    titleMax: 150,
    summaryMin: 48,
    summaryMax: 300,
    sectionMin: 190,
    sectionMax: 1500,
    bodyMin: 960,
  },
};
/** 中文稿的 CJK 字符占比下限；英文稿的 CJK 占比上限 */
const CJK_RATIO_MIN = 0.3;
const CJK_RATIO_MAX = 0.05;

const BANNED_PHRASES = [
  "建议买入", "建议卖出", "目标价", "止损位", "必涨", "必跌", "梭哈", "稳赚", "包赚", "满仓",
  "recommend buying", "recommend selling", "price target", "stop loss", "guaranteed",
  "sure thing", "all in", "will definitely",
];

/** 价格必须带 $ 才被视为价格——裸数字会把年份、条数一并卷进来 */
const PRICE_RE = /\$\s*(\d[\d,]*(?:\.\d+)?)/g;
const PERCENT_RE = /(-?\d+(?:\.\d+)?)\s*%/g;

/** 带位置的数字命中——位置用于回看这句话在讲哪个标的 */
export interface NumberHit {
  value: number;
  index: number;
  /** 匹配文本的结束位置。量级后缀（K/M/bn/万）就紧跟在这之后 */
  end: number;
}

function collectHits(text: string, re: RegExp, strip: boolean): NumberHit[] {
  const out: NumberHit[] = [];
  // matchAll 不会改动共享正则的 lastIndex（内部克隆），模块级 /g 正则可安全复用
  for (const m of text.matchAll(re)) {
    const raw = strip ? m[1].replace(/,/g, "") : m[1];
    const value = parseFloat(raw);
    const index = m.index ?? 0;
    if (Number.isFinite(value)) out.push({ value, index, end: index + m[0].length });
  }
  return out;
}

export function extractPriceHits(text: string): NumberHit[] {
  return collectHits(text, PRICE_RE, true);
}

export function extractPercentHits(text: string): NumberHit[] {
  return collectHits(text, PERCENT_RE, false);
}

export function extractPrices(text: string): number[] {
  return extractPriceHits(text).map((h) => h.value);
}

export function extractPercents(text: string): number[] {
  return extractPercentHits(text).map((h) => h.value);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按传入的 facts 动态构造「标的标签」正则。标的表**不写死**——事实集来自
 * market-facts.ts，两处各写一份迟早会发散。
 *
 * 左右两侧都要求非字母数字边界，这是关键：早期实现用的是 `lastIndexOf(label)`
 * 这种无边界子串匹配，正常英文行情散文会被大面积误绑——con[SOL]idation、
 * [SOL]id、wh[ETH]er、tog[ETH]er 都是高频词。实测 6 句正常英文散文里有 4 句
 * 因此被拒。
 *
 * 误绑的危害**只在误报这一侧**，这点值得写清楚，免得后来的维护者高估这道门槛
 * 的强度：绑定通过的条件是 `priceOk(v, bound)`，未绑定通过的条件是
 * `sourcePrices.has(v) || facts.some(priceOk)`；因为 `bound ∈ facts`，所以
 * 「绑定通过」是「未绑定通过」的**真子集**——绑定只可能更严，不可能更松，
 * 不存在「误绑开出一条 false-pass 通道」这回事。
 * （容易被举成反例的那种情形——伪造的 0.6% 出现在 "whether" 附近、恰好落进
 * ETH +0.59% 的 ±0.2pp 容差——在有没有绑定时**都**能通过，只是没绑定时走的是
 * 全局 `facts.some(pctOk)` 那条路。它是全局事实集本身就宽的结果，与绑定无关。）
 * 修好边界的收益因此是把误报打掉，而不是堵住一个漏洞。
 *
 * 边界用 [^A-Z0-9] 而非 \b：中文场景下「以太坊ETH报价」的两侧都是 CJK，
 * \b 在 CJK 与拉丁字母之间同样成立，但 [^A-Z0-9] 语义更直白且对 `BTC,`、
 * `(ETH)`、`XAUT/PAXG`、`BTC-USDT` 这些真实形态都成立。
 * 长标签排前面，避免某天出现互为前缀的两个标签时短的先赢。
 */
function buildLabelRegExp(facts: MarketFact[]): { re: RegExp; byLabel: Map<string, MarketFact> } | null {
  const byLabel = new Map<string, MarketFact>();
  for (const fact of facts) {
    const key = fact.label.toUpperCase();
    if (!byLabel.has(key)) byLabel.set(key, fact);
  }
  if (byLabel.size === 0) return null;
  const alternation = [...byLabel.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return { re: new RegExp(`(?:^|[^A-Z0-9])(${alternation})(?![A-Z0-9])`, "g"), byLabel };
}

/**
 * 回看数字前方、**同一句之内**最近的事实标签。
 *
 * 存在的理由：只问「这个数字是否匹配某个事实」挡不住张冠李戴——把 BTC 与黄金
 * 的价格互换后，两个数字各自都还在事实集里，门槛会全部放行，而文章却在告诉
 * 读者「BTC 报 $4,325.51」。绑定到具体标的后，换标的立刻暴露。
 *
 * 窗口按句子终止符截断，避免把上一句的标的错误绑过来；再叠一个字符数上限，
 * 兜住整段没有标点的极端情况。
 *
 * 绑不到标签不等于放行：调用方会退回「来源白名单 + 全局事实集」这条更宽但仍然
 * 机械的校验。英文稿更常写 "Bitcoin"/"gold" 而非 "BTC"/"XAUT"，走的正是这条路。
 */
function nearestLabeledFact(
  text: string,
  index: number,
  facts: MarketFact[]
): MarketFact | null {
  const built = buildLabelRegExp(facts);
  if (!built) return null;

  const capped = text.slice(Math.max(0, index - LABEL_PROXIMITY_WINDOW), index);
  // 只保留最后一个句子终止符之后的部分
  const sentenceStart = Math.max(
    ...["。", "！", "？", "\n", ". "].map((p) => capped.lastIndexOf(p))
  );
  const window = (sentenceStart >= 0 ? capped.slice(sentenceStart + 1) : capped).toUpperCase();

  // 取最后一个匹配 = 离数字最近的那个标签
  let best: MarketFact | null = null;
  for (const m of window.matchAll(built.re)) {
    const fact = built.byLabel.get(m[1]);
    if (fact) best = fact;
  }
  return best;
}

/**
 * 解析模型输出。即便开了 JSON 模式，模型偶尔仍会包一层 ``` 围栏；
 * 空内容是 DeepSeek 文档明示的已知问题，这里统一归一成 null 交给调用方重试。
 */
export function parseBriefingJson(raw: string): BriefingJson | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" ? (parsed as BriefingJson) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function cjkRatio(text: string): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  const cjk = chars.filter((c) => /[一-鿿]/.test(c)).length;
  return cjk / chars.length;
}

function checkStructure(json: unknown): { failures: GateFailure[]; briefing: BriefingJson | null } {
  const failures: GateFailure[] = [];
  const b = json as BriefingJson | null;

  if (!b || typeof b !== "object") {
    return { failures: [{ rule: "structure", detail: "不是对象" }], briefing: null };
  }
  if (!isNonEmptyString(b.title)) failures.push({ rule: "structure", detail: "title 缺失或为空" });
  if (!isNonEmptyString(b.summary)) failures.push({ rule: "structure", detail: "summary 缺失或为空" });

  if (!Array.isArray(b.headlines) || b.headlines.length < 2) {
    failures.push({ rule: "structure", detail: "headlines 少于 2 个主题" });
  } else {
    for (const h of b.headlines) {
      // 元素类型必须逐个校验。只查「是非空数组」时，模型吐出
      // points: [{text: "…"}] 这种很自然的漂移会**通过**门槛：长度规则读到的
      // join 结果是 "[object Object]" 而不抛错，字符数也够；随后 render.ts 对
      // 对象调 escapeHtml，s.replace 抛 TypeError，异常落进 runDailyBriefing
      // 的外层 catch —— status: "failed"、无文章，L4 兜底稿根本没被尝试。
      // 在这里拒掉只会让 generateOne 重试并最终优雅降级；崩溃不会。
      if (
        !isNonEmptyString(h?.topic) ||
        !Array.isArray(h?.points) ||
        h.points.length === 0 ||
        !h.points.every(isNonEmptyString)
      ) {
        failures.push({ rule: "structure", detail: `headlines 条目不完整: ${JSON.stringify(h)}` });
      }
    }
  }

  const a = b.analysis;
  if (!a || typeof a !== "object") {
    failures.push({ rule: "structure", detail: "analysis 缺失" });
  } else {
    for (const key of ["overview", "crypto", "gold"] as const) {
      if (!isNonEmptyString(a[key])) {
        failures.push({ rule: "structure", detail: `analysis.${key} 缺失或为空` });
      }
    }
    // 同上：watchlist: [{title, detail}, …] 是模型最常见的漂移形态，
    // 而 render.ts 会直接对元素调 escapeHtml
    if (
      !Array.isArray(a.watchlist) ||
      a.watchlist.length === 0 ||
      !a.watchlist.every(isNonEmptyString)
    ) {
      failures.push({ rule: "structure", detail: "analysis.watchlist 缺失、为空或含非字符串元素" });
    }
  }

  return { failures, briefing: failures.length === 0 ? b : null };
}

function checkLengths(b: BriefingJson, locale: BriefingLocale): GateFailure[] {
  const lim = LIMITS[locale];
  const failures: GateFailure[] = [];
  const titleLen = [...b.title].length;
  if (titleLen < lim.titleMin || titleLen > lim.titleMax) {
    failures.push({
      rule: "length",
      detail: `title 长度 ${titleLen} 不在 ${lim.titleMin}-${lim.titleMax}`,
    });
  }
  const summaryLen = [...b.summary].length;
  if (summaryLen < lim.summaryMin || summaryLen > lim.summaryMax) {
    failures.push({
      rule: "length",
      detail: `summary 长度 ${summaryLen} 不在 ${lim.summaryMin}-${lim.summaryMax}`,
    });
  }
  for (const key of ["overview", "crypto", "gold"] as const) {
    const len = [...b.analysis[key]].length;
    if (len < lim.sectionMin || len > lim.sectionMax) {
      failures.push({
        rule: "length",
        detail: `analysis.${key} 长度 ${len} 不在 ${lim.sectionMin}-${lim.sectionMax}`,
      });
    }
  }
  const bodyLen = [...analysisText(b), ...headlinesText(b)].length;
  if (bodyLen < lim.bodyMin) {
    failures.push({ rule: "length", detail: `正文总长 ${bodyLen} 低于 ${lim.bodyMin}` });
  }
  return failures;
}

/** 只有这部分参与数字核对——headlines 是新闻转述，含大量不属于行情事实的数字 */
function analysisText(b: BriefingJson): string {
  return [b.analysis.overview, b.analysis.crypto, b.analysis.gold, ...b.analysis.watchlist].join("\n");
}

function headlinesText(b: BriefingJson): string {
  return b.headlines.map((h) => `${h.topic}\n${h.points.join("\n")}`).join("\n");
}

function fullText(b: BriefingJson): string {
  return [b.title, b.summary, headlinesText(b), analysisText(b)].join("\n");
}

/**
 * 「模型真正看过的来源」。
 *
 * 来源白名单的正当性完全建立在「这个数字模型确实读到过」之上，可 prompt 只塞了
 * 前 MAX_SOURCES_IN_PROMPT 条（见 prompt.ts），24h 过滤后的 sources 却可能有
 * 200 条。拿全量去背书等于让一个伪造价格被模型从没见过的数字放行——这与 I1
 * 刚修好的原则（列出的来源必须正好是分析真正看过的那些）直接矛盾。
 */
function seenSources(sources: BriefingSource[]): BriefingSource[] {
  return sources.slice(0, MAX_SOURCES_IN_PROMPT);
}

/**
 * 量级后缀。财经新闻几乎不写完整数字：标题是「never fall below $60K」，
 * 而模型转述时会展开成 $60,000——两者指同一个数，精确匹配却对不上。
 *
 * 线上第一次真跑就是栽在这里：源文「Bitcoin will never fall below $60K again」
 * 被模型如实引用成 $60,000，白名单只提取到 60，于是把一句忠实转述判成了编造，
 * 整篇 zh-CN 因此被打回、最终降级成零 AI 兜底稿。
 */
const MAGNITUDE_SUFFIXES: { re: RegExp; scale: number }[] = [
  { re: /^(?:k|thousand|千)/i, scale: 1e3 },
  { re: /^(?:万)/i, scale: 1e4 },
  { re: /^(?:m|mn|million|百万)/i, scale: 1e6 },
  { re: /^(?:亿)/i, scale: 1e8 },
  { re: /^(?:b|bn|billion|十亿)/i, scale: 1e9 },
  { re: /^(?:t|tn|trillion|万亿)/i, scale: 1e12 },
];

/**
 * 从 `text` 中 `index` 之后紧邻的位置读出量级倍数，没有则为 1。
 * 只看紧跟其后（允许一个空格）的那一小段，避免把下一句的词当成后缀。
 */
function magnitudeAt(text: string, index: number): number {
  const tail = text.slice(index, index + 12).replace(/^\s?/, "");
  for (const { re, scale } of MAGNITUDE_SUFFIXES) {
    if (re.test(tail)) return scale;
  }
  return 1;
}

/**
 * 数字幻觉核对。作用域限定在 analysis：headlines 是对新闻的转述，里面的
 * CPI、利率、涨跌数据来自源文而非我们的行情事实集，一并核对会产生大量误报。
 * analysis 中若引用了源文里出现过的数字，同样放行。
 */
function checkNumbers(b: BriefingJson, facts: MarketFact[], sources: BriefingSource[]): GateFailure[] {
  const failures: GateFailure[] = [];
  const text = analysisText(b);
  const sourceText = seenSources(sources)
    .map((s) => `${s.title} ${s.summary}`)
    .join(" ");
  // 源文里的价格要连同量级后缀一起收：$60K 既可能被原样引用（60），
  // 也可能被展开引用（60000），两种写法都是忠实转述。
  const sourcePrices = new Set<number>();
  for (const hit of extractPriceHits(sourceText)) {
    sourcePrices.add(hit.value);
    sourcePrices.add(hit.value * magnitudeAt(sourceText, hit.end));
  }
  const sourcePercents = new Set(extractPercents(sourceText));

  const priceOk = (v: number, f: MarketFact) =>
    Math.abs(v - f.lastPrice) <= f.lastPrice * PRICE_TOLERANCE_RATIO;
  const pctOk = (v: number, f: MarketFact) =>
    Math.abs(v - f.change24hPct) <= PERCENT_TOLERANCE_PP;

  for (const hit of extractPriceHits(text)) {
    const bound = nearestLabeledFact(text, hit.index, facts);
    if (bound) {
      // 绑定到具体标的时，来源白名单**不适用**：否则当天任意一条无关新闻里
      // 巧合出现的同一个数字，就能替一处伪造背书。
      if (!priceOk(hit.value, bound)) {
        failures.push({
          rule: "hallucinated-number",
          detail: `价格 $${hit.value} 与 ${bound.label} 的实际价格 ${bound.lastPrice} 不符`,
        });
      }
      continue;
    }
    if (sourcePrices.has(hit.value)) continue;
    if (!facts.some((f) => priceOk(hit.value, f))) {
      failures.push({ rule: "hallucinated-number", detail: `价格 $${hit.value} 不在行情事实集内` });
    }
  }

  for (const hit of extractPercentHits(text)) {
    const bound = nearestLabeledFact(text, hit.index, facts);
    if (bound) {
      if (!pctOk(hit.value, bound)) {
        failures.push({
          rule: "hallucinated-number",
          detail: `涨跌幅 ${hit.value}% 与 ${bound.label} 的实际涨跌 ${bound.change24hPct}% 不符`,
        });
      }
      continue;
    }
    if (sourcePercents.has(hit.value)) continue;
    if (!facts.some((f) => pctOk(hit.value, f))) {
      failures.push({ rule: "hallucinated-number", detail: `涨跌幅 ${hit.value}% 不在行情事实集内` });
    }
  }
  return failures;
}

/** 源文里出现过的**任何**数字，不要求带 $——见 checkHeadlineNumbers 的说明 */
const BARE_NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/**
 * 白名单候选的有效数字位数下限。
 *
 * BARE_NUMBER_RE 匹配的是**片段**而不是「一个完整的数」：`2026-08-08` 会产出
 * 2026、8、8，`14:30` 产出 14、30，`Q4` 产出 4。这些小整数每天都会把白名单塞满，
 * 而白名单的比对带 ±0.5% 容差，于是 1..99 这一段几乎被铺满，1000 美元以下的
 * 伪造价格有相当概率被「背书」通过。
 *
 * 取 3 位是因为它既能清掉全部两位以内的片段，又不影响真正要放行的两类正例：
 * 源文写 "Tesla slips below 300"（3 位）、模型把源文的 $69,999 改写成 $70,000
 * （5 位）。多出来的误报只会让当天落到兜底稿，方向是安全的那一侧。
 */
const MIN_SOURCE_NUMBER_DIGITS = 3;

/** 去掉千分位、小数点与前导零之后剩下的位数 */
function significantDigits(raw: string): number {
  return raw.replace(/[,.]/g, "").replace(/^0+/, "").length;
}

function extractSourceNumbers(sources: BriefingSource[]): number[] {
  const text = seenSources(sources)
    .map((s) => `${s.title} ${s.summary}`)
    .join(" ");
  const out: number[] = [];
  for (const m of text.matchAll(BARE_NUMBER_RE)) {
    const value = parseFloat(m[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const index = m.index ?? 0;
    const scale = magnitudeAt(text, index + m[0].length);
    // 有量级后缀的数一律收：`$60K` 的有效位只有两位，会被下面的位数过滤挡掉，
    // 但它展开后的 60000 恰恰是模型最可能引用的写法。
    if (scale > 1) out.push(value * scale);
    if (significantDigits(m[0]) < MIN_SOURCE_NUMBER_DIGITS) continue;
    out.push(value);
  }
  return out;
}

/**
 * headlines 的**宽松**价格核对。
 *
 * 把数字核对的作用域限定在 analysis 本身是对的（headlines 是对新闻的转述，
 * 里面的 CPI、利率、涨跌数据来自源文而非我们的行情事实集）。但后果是：
 * headline 里伪造的「BTC 突破 $70,000」会零校验地发布，而同一篇文章的分析段
 * 却被机械核对到 ±0.5%。这条规则补上那个口子。
 *
 * 刻意宽松，三处让步都是为了压住误报：
 * 1. 只查带 $ 的价格。PRICE_RE 本就要求 $，年份、条数、CPI 读数不会被卷进来；
 *    百分比完全不查——那是 headlines 里误报率最高的一类。
 * 2. 不做标的邻近绑定。headline 是一句话转述，绑定假设在这里不成立。
 * 3. 源文侧比对**所有**数字而不只是带 $ 的，且同样给 ±0.5% 容差。源站标题常写
 *    "Tesla slips below 300"（无 $），模型也常把源文的 $69,999 改写成 $70,000；
 *    用精确集合匹配会把这两类正常改写都判成伪造。
 *
 * 但这个"宽松"是有边界的：比对池只取模型真正看过的那些来源（seenSources），
 * 且丢掉有效数字不足 3 位的片段（MIN_SOURCE_NUMBER_DIGITS）——否则日期、时间、
 * 序号切出来的小整数会把白名单塞满，宽松就变成了形同虚设。
 *
 * 误报的代价只是当天落到兜底稿，漏报的代价是把伪造的价格发出去，方向不对称。
 */
function checkHeadlineNumbers(
  b: BriefingJson,
  facts: MarketFact[],
  sources: BriefingSource[]
): GateFailure[] {
  const text = headlinesText(b);
  const hits = extractPriceHits(text);
  if (hits.length === 0) return [];

  const sourceNumbers = extractSourceNumbers(sources);
  const near = (v: number, ref: number) => Math.abs(v - ref) <= Math.abs(ref) * PRICE_TOLERANCE_RATIO;

  // 正文这侧同样要认量级后缀，否则「$1 billion」只会被读成 $1。
  // 线上就栽在这里：源文 "$1B inflows" 译成 "$1 billion"，比对时一个是 1e9、
  // 一个是 1，判成编造。量级词在两侧都归一，才谈得上比对。
  const scaled = hits.map((hit) => ({
    ...hit,
    value: hit.value * magnitudeAt(text, hit.end),
  }));

  return scaled
    .filter(
      (hit) =>
        !facts.some((f) => near(hit.value, f.lastPrice)) &&
        !sourceNumbers.some((n) => near(hit.value, n))
    )
    .map((hit) => ({
      rule: "hallucinated-number",
      detail: `要闻中的价格 $${hit.value} 既不在行情事实集内、也未在源文中出现`,
    }));
}

function checkBannedPhrases(b: BriefingJson): GateFailure[] {
  const text = fullText(b).toLowerCase();
  return BANNED_PHRASES.filter((p) => text.includes(p.toLowerCase())).map((p) => ({
    rule: "banned-phrase",
    detail: `含禁用表述「${p}」`,
  }));
}

/**
 * 语种自检。导出是因为翻译通道（L3）也要用同一把尺子：正文回退链是
 * `content[locale] ?? content["en-US"]`，en-US 不仅要有、还必须**真的是英文**，
 * 否则英文与马来文读者都会看到中文文章。
 */
export function isLocaleLanguageOk(text: string, locale: BriefingLocale): boolean {
  const ratio = cjkRatio(text);
  if (locale === "zh-CN") return ratio >= CJK_RATIO_MIN;
  return ratio <= CJK_RATIO_MAX;
}

function checkLanguage(b: BriefingJson, locale: BriefingLocale): GateFailure[] {
  const text = fullText(b);
  if (isLocaleLanguageOk(text, locale)) return [];
  const ratio = cjkRatio(text);
  return [
    {
      rule: "language",
      detail:
        locale === "zh-CN"
          ? `中文稿 CJK 占比仅 ${ratio.toFixed(2)}`
          : `英文稿 CJK 占比达 ${ratio.toFixed(2)}`,
    },
  ];
}

export function checkBriefing(input: {
  json: unknown;
  facts: MarketFact[];
  sources: BriefingSource[];
  locale: BriefingLocale;
  finishReason: string | null;
}): GateResult {
  const failures: GateFailure[] = [];

  if (input.finishReason === "length") {
    failures.push({ rule: "truncated", detail: "finish_reason 为 length，输出被截断" });
  }

  const { failures: structureFailures, briefing } = checkStructure(input.json);
  failures.push(...structureFailures);

  // 结构不完整时后续规则没有可靠的字段可读，直接返回
  if (!briefing) return { ok: false, failures };

  failures.push(...checkLengths(briefing, input.locale));
  failures.push(...checkNumbers(briefing, input.facts, input.sources));
  failures.push(...checkHeadlineNumbers(briefing, input.facts, input.sources));
  failures.push(...checkBannedPhrases(briefing));
  failures.push(...checkLanguage(briefing, input.locale));

  return { ok: failures.length === 0, failures };
}
