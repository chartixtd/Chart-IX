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

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const SUMMARY_MIN = 20;
const SUMMARY_MAX = 120;
const SECTION_MIN = 80;
const SECTION_MAX = 600;
/** 渲染后正文总长下限，用于兜住"结构齐全但内容稀薄"的半截输出 */
const BODY_MIN = 400;
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
}

function collectHits(text: string, re: RegExp, strip: boolean): NumberHit[] {
  const out: NumberHit[] = [];
  // matchAll 不会改动共享正则的 lastIndex（内部克隆），模块级 /g 正则可安全复用
  for (const m of text.matchAll(re)) {
    const raw = strip ? m[1].replace(/,/g, "") : m[1];
    const value = parseFloat(raw);
    if (Number.isFinite(value)) out.push({ value, index: m.index ?? 0 });
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
 * 因此被拒。而且这**不是**「偏安全」的误报：绑定成功的分支会跳过来源白名单与
 * 全局事实校验，于是一个伪造的 0.6% 出现在 "whether" 附近反而会绑到 ETH
 * （+0.59%，容差 ±0.2pp）而**通过**——本该拦下的数字被放行了。
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

function checkLengths(b: BriefingJson): GateFailure[] {
  const failures: GateFailure[] = [];
  const titleLen = [...b.title].length;
  if (titleLen < TITLE_MIN || titleLen > TITLE_MAX) {
    failures.push({ rule: "length", detail: `title 长度 ${titleLen} 不在 ${TITLE_MIN}-${TITLE_MAX}` });
  }
  const summaryLen = [...b.summary].length;
  if (summaryLen < SUMMARY_MIN || summaryLen > SUMMARY_MAX) {
    failures.push({ rule: "length", detail: `summary 长度 ${summaryLen} 不在 ${SUMMARY_MIN}-${SUMMARY_MAX}` });
  }
  for (const key of ["overview", "crypto", "gold"] as const) {
    const len = [...b.analysis[key]].length;
    if (len < SECTION_MIN || len > SECTION_MAX) {
      failures.push({ rule: "length", detail: `analysis.${key} 长度 ${len} 不在 ${SECTION_MIN}-${SECTION_MAX}` });
    }
  }
  const bodyLen = [...analysisText(b), ...headlinesText(b)].length;
  if (bodyLen < BODY_MIN) {
    failures.push({ rule: "length", detail: `正文总长 ${bodyLen} 低于 ${BODY_MIN}` });
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
 * 数字幻觉核对。作用域限定在 analysis：headlines 是对新闻的转述，里面的
 * CPI、利率、涨跌数据来自源文而非我们的行情事实集，一并核对会产生大量误报。
 * analysis 中若引用了源文里出现过的数字，同样放行。
 */
function checkNumbers(b: BriefingJson, facts: MarketFact[], sources: BriefingSource[]): GateFailure[] {
  const failures: GateFailure[] = [];
  const text = analysisText(b);
  const sourceText = sources.map((s) => `${s.title} ${s.summary}`).join(" ");
  const sourcePrices = new Set(extractPrices(sourceText));
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

function extractSourceNumbers(sources: BriefingSource[]): number[] {
  const text = sources.map((s) => `${s.title} ${s.summary}`).join(" ");
  const out: number[] = [];
  for (const m of text.matchAll(BARE_NUMBER_RE)) {
    const value = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isFinite(value)) out.push(value);
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
 * 误报的代价只是当天落到兜底稿，漏报的代价是把伪造的价格发出去，方向不对称。
 */
function checkHeadlineNumbers(
  b: BriefingJson,
  facts: MarketFact[],
  sources: BriefingSource[]
): GateFailure[] {
  const hits = extractPriceHits(headlinesText(b));
  if (hits.length === 0) return [];

  const sourceNumbers = extractSourceNumbers(sources);
  const near = (v: number, ref: number) => Math.abs(v - ref) <= Math.abs(ref) * PRICE_TOLERANCE_RATIO;

  return hits
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

  failures.push(...checkLengths(briefing));
  failures.push(...checkNumbers(briefing, input.facts, input.sources));
  failures.push(...checkHeadlineNumbers(briefing, input.facts, input.sources));
  failures.push(...checkBannedPhrases(briefing));
  failures.push(...checkLanguage(briefing, input.locale));

  return { ok: failures.length === 0, failures };
}
