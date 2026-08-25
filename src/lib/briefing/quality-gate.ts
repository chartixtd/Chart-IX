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
    // 英文上限必须能装下「中文写到上限、再按实测倍率翻译」的结果，否则一篇
    // 完全合法的中文稿会在翻译后被英文尺子拒掉。实测倍率：标题 4.2×、
    // 导读/段落 2.8×（见上面的生产数据）。zh titleMax 60 × 4.2 ≈ 252，
    // 旧值 150 连一半余量都没有——第一次生产样本 127/150 已用掉 85%，
    // 稍长一点的合法标题就是必死。max 检查在翻译产物上防的是"跑飞"而不是
    // 截断（翻译不会截断），松一点是安全方向。
    titleMax: 260,
    summaryMin: 48,
    summaryMax: 350,
    sectionMin: 190,
    sectionMax: 1700,
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

/**
 * 英文禁用词必须按**词边界**匹配，不能子串匹配。
 *
 * 子串匹配时 "all in" 会命中 over[all in]flation、sm[all in]crease、
 * over[all in]terest——这些是宏观+加密简报几乎每天都会出现的词组，实测四句
 * 正常英文散文全部误命中。英文版是翻译产物、走的是同一道门槛，误命中的结果
 * 是整个英文版被打回兜底稿。中文没有词边界概念，保持原样的 includes。
 *
 * 边界用 (?<![a-z0-9]) / (?![a-z0-9])：短语两端不能紧贴字母数字，但允许
 * 标点与空白（"go all in." 仍然命中）。
 */
const BANNED_LATIN_RES: { phrase: string; re: RegExp }[] = BANNED_PHRASES.filter((p) =>
  /[a-z]/i.test(p)
).map((p) => ({
  phrase: p,
  re: new RegExp(`(?<![a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i"),
}));

const BANNED_CJK = BANNED_PHRASES.filter((p) => !/[a-z]/i.test(p));

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
 * 并列枚举标记。
 *
 * 「XAUT 与 PAXG 分别报 $4,300.03 和 $4,330.09」这种写法里，「离数字最近的标签
 * 拥有这个数字」这条假设直接不成立——$4,300.03 前方最近的标签是 PAXG，而它其实
 * 属于 XAUT。线上 2026-08-10 的中英两版**各被这一条拒过一次**。
 *
 * 遇到枚举就**放弃绑定**，退回「来源白名单 + 全局事实集」那条更宽但仍然机械的
 * 路——那正是绑不到标签时本来就会走的路。这不会开出新的漏洞：枚举句里的数字
 * 仍须逐个落在当天真实的事实集里，只是不再要求它们与标签一一对齐。
 */
const ENUMERATION_RE = /分别|各自|respectively/i;

const SENTENCE_ENDS = ["。", "！", "？", "\n", ". "];

/** 数字前方、同一句之内的那一小段文本。标的绑定与方向词都在它上面回看 */
function windowBefore(text: string, index: number): string {
  const capped = text.slice(Math.max(0, index - LABEL_PROXIMITY_WINDOW), index);
  // 只保留最后一个句子终止符之后的部分
  const sentenceStart = Math.max(...SENTENCE_ENDS.map((p) => capped.lastIndexOf(p)));
  return sentenceStart >= 0 ? capped.slice(sentenceStart + 1) : capped;
}

/**
 * 数字所在的**整句**（不设字符数上限，且要往后看）。
 *
 * 枚举标记只在回看窗口里找是不够的：中文把「分别」放在数字**前**，英文的
 * respectively 却放在整句**末尾**——
 *   zh  黄金代币XAUT和PAXG分别报$4,300.03和$4,330.09
 *   en  Gold tokens XAUT and PAXG were quoted at $4,300.03 and $4,330.09 respectively
 * 同一句话，中文版过了门槛、英文版被拒，英文早报因此降级成兜底稿。判据必须
 * 覆盖整句，否则它只对一种语序有效。
 */
function sentenceAround(text: string, index: number): string {
  const head = text.slice(0, index);
  const start = Math.max(0, ...SENTENCE_ENDS.map((p) => head.lastIndexOf(p) + 1));
  const rest = text.slice(index);
  const m = /[。！？\n]|\.\s/.exec(rest);
  return text.slice(start, index + (m ? m.index : rest.length));
}

/**
 * 回看数字前方、**同一句之内**出现过的事实标签。
 *
 * 存在的理由：只问「这个数字是否匹配某个事实」挡不住张冠李戴——把 BTC 与黄金
 * 的价格互换后，两个数字各自都还在事实集里，门槛会全部放行，而文章却在告诉
 * 读者「BTC 报 $4,325.51」。绑定到具体标的后，换标的立刻暴露。
 *
 * 窗口按句子终止符截断，避免把上一句的标的错误绑过来；再叠一个字符数上限，
 * 兜住整段没有标点的极端情况。
 *
 * 返回的是**窗口里的全部标签**而不是最近的那一个。差别只在一句话同时提到两个
 * 标的时才显现，而那恰恰是每天都会发生的事——黄金那段每天都写「XAUT 和 PAXG
 * 报 $A 和 $B」。此时「最近的标签拥有这个数字」是错的（$A 属于 XAUT，最近的
 * 标签却是 PAXG），而要求「数字对得上句中提到的某一个标的」仍然是一道真门槛：
 * 候选集是事实集的子集，比绑不到标签时走的全局校验严格得多。
 *   - "The two gold tokens XAUT/PAXG $1,914.99"：1914.99 两个金币都对不上 → 仍被拒
 *   - "BTC 与以太坊双双走高，其中 ETH 报 $1,914.99"：对上了句中的 ETH → 放行
 *
 * 返回 null 表示不绑定，调用方退回「来源白名单 + 全局事实集」这条更宽但仍然机械
 * 的校验。两种情形会走到这里：句中一个标签都没有（英文稿更常写 "Bitcoin"/"gold"
 * 而非 "BTC"/"XAUT"），或者句子是并列枚举（见 ENUMERATION_RE）——枚举句里连
 * 「数字属于句中某个标的」都不该假定，因为标的与数字的对应关系全靠语序。
 */
function labeledFactCandidates(
  text: string,
  index: number,
  // 由调用方构建一次后传入——checkNumbers 对每个数字命中都要回看一次，
  // 在这里重建正则等于每个数字都重排一遍标签表
  built: ReturnType<typeof buildLabelRegExp>
): MarketFact[] | null {
  if (!built) return null;
  if (ENUMERATION_RE.test(sentenceAround(text, index))) return null;

  const window = windowBefore(text, index).toUpperCase();
  const found: MarketFact[] = [];
  for (const m of window.matchAll(built.re)) {
    const fact = built.byLabel.get(m[1]);
    if (fact && !found.includes(fact)) found.push(fact);
  }
  return found.length > 0 ? found : null;
}

/** 失败详情里的标的名与数值。多个候选时列全，便于事后回看当时比的是谁 */
function joinLabels(facts: MarketFact[]): string {
  return facts.map((f) => f.label).join("/");
}

function joinValues(facts: MarketFact[], pick: (f: MarketFact) => number): string {
  return facts.map(pick).join("/");
}

/**
 * 方向词。中文与英文都把涨跌的方向写在**词**里而不是数上：「XAUT 下跌 0.52%」
 * 对应的事实是 -0.52%，句子完全正确，可门槛此前只认字面上的负号，于是把它判成
 * 幻觉。线上 2026-08-10 三次生成里有两次栽在这一条上，当天发的是零 AI 兜底稿。
 *
 * 只有**下跌**词会带来一个额外的候选值（见 percentCandidates），上涨词不会——
 * 这保证放宽只发生在「文字说跌、事实也是跌」的方向上，写错方向照样被拒。
 */
const DOWN_CUE_RE =
  /跌|回落|走低|下挫|下滑|下降|下行|缩水|减少|(?<![a-z])(?:fell|fall(?:s|ing)?|declin\w*|drop\w*|slipp?\w*|lost|loss\w*|losing|lower|down|retreat\w*|shed|sank|sunk|slid\w*|weaken\w*)(?![a-z])/gi;

const UP_CUE_RE =
  /涨|走高|上扬|攀升|反弹|回升|上行|增长|(?<![a-z])(?:rose|rise|rising|gain\w*|climb\w*|advanc\w*|higher|up|surg\w*|jump\w*|rall\w*|add(?:s|ed|ing)?|firm\w*)(?![a-z])/gi;

/** 方向词也可能写在数字**之后**：「ending 0.52% lower」「0.52% 的跌幅」 */
const FORWARD_CUE_WINDOW = 24;

type Direction = "up" | "down";

function cueIndices(window: string, re: RegExp): number[] {
  // matchAll 内部克隆正则，模块级 /g 正则可安全复用（与 collectHits 同理）
  return [...window.matchAll(re)].map((m) => m.index ?? 0);
}

/**
 * 窗口里离数字最近的那个方向词。回看窗口取最后一个（最靠近数字的），
 * 前看窗口取第一个——「BTC 下跌 0.5%，ETH 上涨 0.3%」里给 0.3% 定调的
 * 只能是「上涨」，不能是更早的那个「下跌」。
 */
function nearestDirection(window: string, prefer: "last" | "first"): Direction | null {
  const down = cueIndices(window, DOWN_CUE_RE);
  const up = cueIndices(window, UP_CUE_RE);
  if (down.length === 0 && up.length === 0) return null;
  if (up.length === 0) return "down";
  if (down.length === 0) return "up";
  const pick = (xs: number[]) => (prefer === "last" ? Math.max(...xs) : Math.min(...xs));
  const d = pick(down);
  const u = pick(up);
  return (prefer === "last" ? d > u : d < u) ? "down" : "up";
}

function directionAt(text: string, hit: NumberHit): Direction | null {
  const before = nearestDirection(windowBefore(text, hit.index), "last");
  if (before) return before;
  // 后向窗口在**任何**标点处就断。不断的话，「BTC 上涨 0.92%，XAUT 下跌 0.52%」
  // 里后半句的「下跌」会漂给前一个数字，等于给 BTC 白送一个 -0.92 的候选值。
  const after = text.slice(hit.end, hit.end + FORWARD_CUE_WINDOW).split(/[，,。；;！？!?\n]/)[0];
  return nearestDirection(after, "first");
}

/** 数字本身带没带正负号。带了就以它为准，不再看方向词 */
function hasExplicitSign(text: string, hit: NumberHit): boolean {
  return hit.value < 0 || text[hit.index - 1] === "+";
}

/**
 * 一个百分比在事实集口径下的候选值。
 *
 * 无符号、且最近的方向词是「跌」时，-v 与 v 都算候选。这是**单向**放宽，
 * 不会放过写错方向的稿：
 * - 「下跌 0.52%」事实 -0.52% → 候选含 -0.52，通过（这正是要修的误报）
 * - 「上涨 0.52%」事实 -0.52% → 上涨词不产生负候选，仍被拒
 * - 「下跌 0.92%」事实 +0.92% → 候选 {0.92, -0.92} 与 +0.92 比：0.92 命中……
 *   这一例确实会通过，代价是「把涨写成跌、幅度还刚好对上」漏过去。同一个数字
 *   在没有方向词时本来也会通过（门槛从来只核对数值），所以它不是这次放宽引入的
 *   新洞；真正引入的只有负候选那一半。
 */
function percentCandidates(text: string, hit: NumberHit): number[] {
  if (hasExplicitSign(text, hit)) return [hit.value];
  return directionAt(text, hit) === "down" ? [hit.value, -hit.value] : [hit.value];
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
    if (!parsed || typeof parsed !== "object") return null;
    return coerceBriefingShape(parsed) as BriefingJson;
  } catch {
    return null;
  }
}

/**
 * 结构漂移的无损展平。
 *
 * 模型最常见的漂移不是漏字段，而是**多包一层**：本该是 `["关注美联储讲话"]` 的
 * 地方给了 `[{ title: "关注美联储", detail: "本周有讲话" }]`，或者干脆给一个
 * 字符串。语义完整，只是形状不对。checkStructure 会（也必须）拒掉这种输入——
 * render.ts 对对象调 escapeHtml 会抛 TypeError——但拒稿的代价是白烧一次模型
 * 调用，三次机会用完就落兜底稿。线上 2026-08-10 的第二次生成正是死在
 * 「analysis.watchlist 含非字符串元素」上。
 *
 * 能还原成字符串的就地展平，还原不了的（比如空对象、嵌套数组）原样留着，
 * 仍然交给 checkStructure 拒掉——这里只做形状归一，不发明内容。
 */
function flattenToString(v: unknown): unknown {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const parts = Object.values(v as Record<string, unknown>).filter(isNonEmptyString);
  if (parts.length === 0) return v;
  if (parts.length === 1) return parts[0];
  // 首段当标题、其余接在后面。冒号按语种选：中文全角、英文半角加空格
  const joiner = /[一-鿿]/.test(parts[0]) ? "：" : ": ";
  return `${parts[0]}${joiner}${parts.slice(1).join(" ")}`;
}

/**
 * 该是字符串数组的字段：归一成字符串数组。
 *
 * 覆盖的四种漂移，都是「语义完整、只是形状不对」：
 * - 单个字符串           `"关注美联储"`            → `["关注美联储"]`
 * - 外面多包一层数组     `[["关注美联储", "关注黄金"]]` → 拆掉外层再处理
 * - 编号对象当数组用     `{"1": "…", "2": "…"}`     → 取 values
 * - 元素多包一层对象     `[{title, detail}]`        → 由 flattenToString 展平
 *
 * 最后把展不平的空值（null、空串、空对象）**丢掉**。丢弃看似有损，实则相反：
 * 一个 null 元素本来就不携带内容，留着只保证整篇被拒、白烧一次模型调用；
 * 而全是空值时结果是空数组，checkStructure 照样会拒——不会因此发出一篇空稿。
 */
function toStringArray(v: unknown): unknown {
  if (isNonEmptyString(v)) return [v];
  // 编号对象：`{"1": "…"}`。数组走下面的分支，null 不是对象要先挡掉
  if (v && typeof v === "object" && !Array.isArray(v)) {
    v = Object.values(v as Record<string, unknown>);
  }
  if (!Array.isArray(v)) return v;
  // 只拆**唯一**元素是数组的情形。那是「整张列表被多包了一层」，语义明确；
  // 若多个元素都是数组，含义就说不准了（拆开？还是各自 join？），留给门槛拒掉。
  const arr = v.length === 1 && Array.isArray(v[0]) ? (v[0] as unknown[]) : v;
  return arr
    .map(flattenToString)
    .filter((x) => x !== null && x !== undefined && !(typeof x === "string" && !x.trim()));
}

function coerceBriefingShape(json: object): object {
  const b = json as Record<string, unknown>;

  if (Array.isArray(b.headlines)) {
    b.headlines = b.headlines.map((h) => {
      if (!h || typeof h !== "object" || Array.isArray(h)) return h;
      const item = h as Record<string, unknown>;
      return { ...item, points: toStringArray(item.points) };
    });
  }

  const a = b.analysis;
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const analysis = a as Record<string, unknown>;
    // watchlist 被提到顶层是另一种「语义完整、位置不对」的漂移：prompt 把它画在
    // analysis 里，而模型有时按 title/summary/headlines/watchlist 的平铺习惯输出。
    // analysis 里那份为空时才认顶层的，绝不覆盖模型真的写在正确位置上的内容。
    const hoisted = toStringArray(analysis.watchlist);
    analysis.watchlist =
      Array.isArray(hoisted) && hoisted.length > 0 ? hoisted : toStringArray(b.watchlist);
  }

  return b;
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
  if (!isNonEmptyString(b.title)) {
    failures.push({ rule: "structure", detail: `title 缺失或为空: ${preview(b.title)}` });
  }
  if (!isNonEmptyString(b.summary)) {
    failures.push({ rule: "structure", detail: `summary 缺失或为空: ${preview(b.summary)}` });
  }

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
        failures.push({ rule: "structure", detail: `analysis.${key} 缺失或为空: ${preview(a[key])}` });
      }
    }
    // 同上：watchlist: [{title, detail}, …] 是模型最常见的漂移形态，
    // 而 render.ts 会直接对元素调 escapeHtml
    if (
      !Array.isArray(a.watchlist) ||
      a.watchlist.length === 0 ||
      !a.watchlist.every(isNonEmptyString)
    ) {
      failures.push({
        rule: "structure",
        detail: `analysis.watchlist 缺失、为空或含非字符串元素: ${preview(a.watchlist)}`,
      });
    }
  }

  return { failures, briefing: failures.length === 0 ? b : null };
}

/**
 * 把出问题的那个值截一段放进诊断。
 *
 * 2026-08-25 的第一次生成死在「analysis.watchlist 缺失、为空或含非字符串元素」上，
 * 而这句话对着三种完全不同的输入（字段没给、给了空数组、给了对象数组）是同一句，
 * 于是「该往展平里补哪一种形状」只能靠猜。展平能覆盖的形状是有限的，下一次
 * 遇到新形状时，诊断里必须直接看得到它长什么样。
 *
 * 截断到 160 字符：够认出形状，又不会把整篇稿子灌进 Telegram 告警。
 */
function preview(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
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
/**
 * 白名单要扫的字段。`body` 可选——不是所有调用方都抓了正文（早期的测试夹具、
 * 以及理论上未来某条不抓正文的路径），门槛不能因为字段缺失就崩。
 */
type SourceLike = BriefingSource & { body?: string };

function seenSources(sources: SourceLike[]): SourceLike[] {
  return sources.slice(0, MAX_SOURCES_IN_PROMPT);
}

/**
 * 把一条来源拼成用于白名单比对的文本。
 *
 * 必须含 body，否则白名单只看得到 RSS 的标题和一两句摘要，而 prompt 早就
 * 把抓到的正文喂给模型了——模型能读到、写进早报的数字，门槛却读不到、
 * 白名单永远找不到匹配。线上真实栽过一次：模型从正文里读出「长期价格或达
 * 150万美元」，翻译成英文后是 $1,500,000，白名单却只扫了标题和摘要，
 * 找不到这个数字，判成编造，把已经翻译好的英文版打回兜底稿。
 */
function sourceWhitelistText(sources: SourceLike[]): string {
  return seenSources(sources)
    .map((s) => `${s.title} ${s.summary} ${s.body ?? ""}`)
    .join(" ");
}

/**
 * 量级后缀。财经新闻几乎不写完整数字：标题是「never fall below $60K」，
 * 而模型转述时会展开成 $60,000——两者指同一个数，精确匹配却对不上。
 *
 * 线上第一次真跑就是栽在这里：源文「Bitcoin will never fall below $60K again」
 * 被模型如实引用成 $60,000，白名单只提取到 60，于是把一句忠实转述判成了编造，
 * 整篇 zh-CN 因此被打回、最终降级成零 AI 兜底稿。
 */
/**
 * 两条规则都吃过亏，不是风格问题：
 *
 * 1. 拉丁后缀必须带 `(?![a-z])` 词边界。裸 `b` 会匹配 before 的首字母、裸 `m`
 *    会匹配 market——"$64,959.52 before easing" 被放大成 649 亿后再和事实集
 *    比对，合法价格直接判编造。这个缺陷在只扫源文侧时一直潜伏（夹具没踩到），
 *    扩到正文侧的第一天就把三条英文测试全部打红。
 * 2. 数组按倍率**从大到小**排：`万亿` 若排在 `万` 之后永远轮不到——150万亿
 *    会被读成 150万。同理 trillion 组要在 billion 组之前。
 *    （单条正则内部的 billion|bn|b 顺序无所谓：`b` 先匹配但边界断言失败时，
 *    正则引擎会回溯尝试更长的备选。）
 */
const MAGNITUDE_SUFFIXES: { re: RegExp; scale: number }[] = [
  { re: /^(?:trillion|tn|t)(?![a-z])/i, scale: 1e12 },
  { re: /^万亿/, scale: 1e12 },
  { re: /^(?:billion|bn|b)(?![a-z])/i, scale: 1e9 },
  { re: /^十亿/, scale: 1e9 },
  { re: /^亿/, scale: 1e8 },
  { re: /^(?:million|mn|m)(?![a-z])/i, scale: 1e6 },
  { re: /^百万/, scale: 1e6 },
  { re: /^万/, scale: 1e4 },
  { re: /^(?:thousand|k)(?![a-z])/i, scale: 1e3 },
  { re: /^千/, scale: 1e3 },
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
function checkNumbers(
  b: BriefingJson,
  facts: MarketFact[],
  sources: SourceLike[],
  /** 翻译产物才有：已过门槛的原稿里的数字，见 extractBriefingNumbers */
  baselineNumbers: number[] = []
): GateFailure[] {
  const failures: GateFailure[] = [];
  const text = analysisText(b);
  const sourceText = sourceWhitelistText(sources);
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
  const labelRe = buildLabelRegExp(facts);

  for (const hit of extractPriceHits(text)) {
    // 正文侧同样要认量级后缀，与 checkHeadlineNumbers 对称。不认的话，
    // 中文「150万美元」被 Google Translate 译成 "$1.5 million" 后只会被读成
    // 1.5，而源文正文里写的是 $1,500,000——两侧归一口径不一致，合法译文
    // 就会被判成编造。这正是线上第 5/6 号事故的形状，此前只修了 headlines 侧。
    const value = hit.value * magnitudeAt(text, hit.end);
    const bounds = labeledFactCandidates(text, hit.index, labelRe);
    if (bounds) {
      // 绑定到具体标的时，来源白名单**不适用**：否则当天任意一条无关新闻里
      // 巧合出现的同一个数字，就能替一处伪造背书。
      if (!bounds.some((f) => priceOk(value, f))) {
        failures.push({
          rule: "hallucinated-number",
          detail: `价格 $${value} 与 ${joinLabels(bounds)} 的实际价格 ${joinValues(
            bounds,
            (f) => f.lastPrice
          )} 不符`,
        });
      }
      continue;
    }
    if (sourcePrices.has(value)) continue;
    // 原稿里出现过的数字放行。容差与源文侧一致——翻译器会把 $63,877.23
    // 写成 $63,877 或 $63.9K，都是忠实转述。
    if (baselineNumbers.some((n) => Math.abs(value - n) <= Math.abs(n) * PRICE_TOLERANCE_RATIO)) {
      continue;
    }
    if (!facts.some((f) => priceOk(value, f))) {
      failures.push({ rule: "hallucinated-number", detail: `价格 $${value} 不在行情事实集内` });
    }
  }

  for (const hit of extractPercentHits(text)) {
    // 「下跌 0.52%」的方向在词里、不在数上，候选值因此可能有两个
    const candidates = percentCandidates(text, hit);
    const bounds = labeledFactCandidates(text, hit.index, labelRe);
    if (bounds) {
      if (!candidates.some((v) => bounds.some((f) => pctOk(v, f)))) {
        // 有意**不**回落来源白名单，和价格侧保持一致。曾考虑过对百分比放宽
        // （「SOL 领涨，成交量增长 12%」里的 12% 来自源文却会被绑到 SOL 判错），
        // 但那正是 Task 5 人工裁决时演示过的漏洞原型：无关新闻里的 7.50% 替
        // 伪造的「BTC 上涨 7.50%」背书。误报的代价是当天落兜底稿，漏报的代价
        // 是把伪造涨跌发出去——按已定的取舍，宁严勿松。
        failures.push({
          rule: "hallucinated-number",
          detail: `涨跌幅 ${hit.value}% 与 ${joinLabels(bounds)} 的实际涨跌 ${joinValues(
            bounds,
            (f) => f.change24hPct
          )}% 不符`,
        });
      }
      continue;
    }
    if (sourcePercents.has(hit.value)) continue;
    if (!candidates.some((v) => facts.some((f) => pctOk(v, f)))) {
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

function extractSourceNumbers(sources: SourceLike[]): number[] {
  const text = sourceWhitelistText(sources);
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
 * 已过门槛的原稿里出现过的所有数字 —— 翻译产物专用的白名单。
 *
 * 存在的理由是一条**结构性单向偏差**：数字核对只查带 `$` 的写法（PRICE_RE
 * 要求 `$`），而中文写「70亿美元」不带 `$`、英文写 `$7 billion` 带。同一个
 * 事实，中文稿整条规则碰不到，翻成英文立刻被抓——这条规则实际上只咬英文版。
 * 线上表现就是「中文正常发布，英文天天降级成兜底稿」。
 *
 * 正确的比对基准不是新闻源文，而是原稿本身：原稿已经跑完整套门槛（含对源文
 * 与行情事实集的数字核对），翻译被允许**搬运**它的数字，不被允许发明新数字。
 * 拿原稿当白名单既更贴合"翻译"这件事的语义，也绕开了源文抽取那些启发式规则
 * 的误报——比如 MIN_SOURCE_NUMBER_DIGITS 会丢掉两位数，导致译文里的 `$20`
 * 在结构上永远匹配不上。
 *
 * 这里**不套** MIN_SOURCE_NUMBER_DIGITS：原稿是几百字的成稿，不是几十篇文章
 * 正文拼成的字符串汤，小整数不会把白名单塞满。
 *
 * 收窄了什么：翻译若把 $63,000 写成 $630,000，原稿里没有 630000，照样拦下。
 * 真正的翻译幻觉仍然被抓，被放行的只有"原稿本来就有"的数。
 */
export function extractBriefingNumbers(b: BriefingJson): number[] {
  const text = fullText(b);
  const out: number[] = [];
  for (const m of text.matchAll(BARE_NUMBER_RE)) {
    const value = parseFloat(m[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push(value);
    // 「70亿」要同时收 70 和 7e9：译文可能写 "$7 billion"（→7e9），
    // 也可能写 "7 billion"（→7e9）或直接照搬 70。两侧口径都归一才谈得上比对。
    const scale = magnitudeAt(text, (m.index ?? 0) + m[0].length);
    if (scale > 1) out.push(value * scale);
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
  sources: SourceLike[],
  /** 翻译产物才有：已过门槛的原稿里的数字，见 extractBriefingNumbers */
  baselineNumbers: number[] = []
): GateFailure[] {
  const text = headlinesText(b);
  const hits = extractPriceHits(text);
  if (hits.length === 0) return [];

  const sourceNumbers = [...extractSourceNumbers(sources), ...baselineNumbers];
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
  const text = fullText(b);
  const lower = text.toLowerCase();
  const hits: string[] = [
    ...BANNED_CJK.filter((p) => lower.includes(p)),
    ...BANNED_LATIN_RES.filter(({ re }) => re.test(text)).map(({ phrase }) => phrase),
  ];
  return hits.map((p) => ({
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
  /** 含 body 时（SourceWithBody[]），数字白名单会扫正文而不只是标题/摘要 */
  sources: SourceLike[];
  locale: BriefingLocale;
  finishReason: string | null;
  /**
   * 校验的是**翻译产物**时传入已过门槛的原稿。原稿里出现过的数字会进白名单——
   * 翻译只被允许搬运数字，不被允许发明数字，拿原稿比对既贴合语义、又避开
   * 只查 `$` 带来的中英单向偏差（见 extractBriefingNumbers 的说明）。
   * 生成路径不传，行为与此前完全一致。
   */
  baseline?: BriefingJson;
}): GateResult {
  const failures: GateFailure[] = [];

  if (input.finishReason === "length") {
    failures.push({ rule: "truncated", detail: "finish_reason 为 length，输出被截断" });
  }

  const { failures: structureFailures, briefing } = checkStructure(input.json);
  failures.push(...structureFailures);

  // 结构不完整时后续规则没有可靠的字段可读，直接返回
  if (!briefing) return { ok: false, failures };

  const baselineNumbers = input.baseline ? extractBriefingNumbers(input.baseline) : [];

  failures.push(...checkLengths(briefing, input.locale));
  failures.push(...checkNumbers(briefing, input.facts, input.sources, baselineNumbers));
  failures.push(...checkHeadlineNumbers(briefing, input.facts, input.sources, baselineNumbers));
  failures.push(...checkBannedPhrases(briefing));
  failures.push(...checkLanguage(briefing, input.locale));

  return { ok: failures.length === 0, failures };
}
