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

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PERCENT_RE)) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
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
      if (!isNonEmptyString(h?.topic) || !Array.isArray(h?.points) || h.points.length === 0) {
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
    if (!Array.isArray(a.watchlist) || a.watchlist.length === 0) {
      failures.push({ rule: "structure", detail: "analysis.watchlist 缺失或为空" });
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

  for (const price of extractPrices(text)) {
    if (sourcePrices.has(price)) continue;
    const matched = facts.some(
      (f) => Math.abs(price - f.lastPrice) <= f.lastPrice * PRICE_TOLERANCE_RATIO
    );
    if (!matched) {
      failures.push({ rule: "hallucinated-number", detail: `价格 $${price} 不在行情事实集内` });
    }
  }

  for (const pct of extractPercents(text)) {
    if (sourcePercents.has(pct)) continue;
    const matched = facts.some((f) => Math.abs(pct - f.change24hPct) <= PERCENT_TOLERANCE_PP);
    if (!matched) {
      failures.push({ rule: "hallucinated-number", detail: `涨跌幅 ${pct}% 不在行情事实集内` });
    }
  }
  return failures;
}

function checkBannedPhrases(b: BriefingJson): GateFailure[] {
  const text = fullText(b).toLowerCase();
  return BANNED_PHRASES.filter((p) => text.includes(p.toLowerCase())).map((p) => ({
    rule: "banned-phrase",
    detail: `含禁用表述「${p}」`,
  }));
}

function checkLanguage(b: BriefingJson, locale: BriefingLocale): GateFailure[] {
  const ratio = cjkRatio(fullText(b));
  if (locale === "zh-CN" && ratio < CJK_RATIO_MIN) {
    return [{ rule: "language", detail: `中文稿 CJK 占比仅 ${ratio.toFixed(2)}` }];
  }
  if (locale === "en-US" && ratio > CJK_RATIO_MAX) {
    return [{ rule: "language", detail: `英文稿 CJK 占比达 ${ratio.toFixed(2)}` }];
  }
  return [];
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
  failures.push(...checkBannedPhrases(briefing));
  failures.push(...checkLanguage(briefing, input.locale));

  return { ok: failures.length === 0, failures };
}
