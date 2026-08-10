import type { BriefingLocale } from "./types";

/**
 * 早报标题的**唯一**格式：
 *   zh-CN  早报 | 8月10日 比特币震荡，黄金续创新高
 *   en-US  Daily Briefing | Aug 10 — Bitcoin steady, gold extends gains
 *
 * 为什么要有这么一个模块：栏目每天更新，标题是读者在列表页唯一能扫到的东西，
 * 格式漂移会让它看起来像三个不同的栏目。而线上真实产出过三种形态——
 *   「早报｜8月9日 比特币震荡…」   模型自己写的（全角竖线、无空格）
 *   「早报 | 8月8日 …」            prompt 示例里的样子
 *   「24 小时要闻速览 | 2026-08-10」兜底稿自己拼的（连"早报"两个字都没有）
 * 三者出自三处代码，各自看都说得通。所以格式**只在这里定义一次**，
 * 模型稿、翻译稿、兜底稿都从这里出。
 */

const EN_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PREFIX: Record<BriefingLocale, string> = {
  "zh-CN": "早报",
  "en-US": "Daily Briefing",
};

/** 日期与正题之间的分隔。中文靠空格就够，英文不加破折号会读成一句话 */
const SUBJECT_SEP: Record<BriefingLocale, string> = { "zh-CN": " ", "en-US": " — " };

/** 「2026-08-10」→「8月10日」/「Aug 10」。年份不进标题——早报只在当天看 */
export function briefingDateLabel(dateStr: string, locale: BriefingLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return dateStr;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return dateStr;
  return locale === "zh-CN" ? `${month}月${day}日` : `${EN_MONTHS[month - 1]} ${day}`;
}

/**
 * 标题开头可以被安全剥掉的片段：栏目名、日期、分隔符。
 *
 * 全部**锚定在开头**并循环剥离，因此不挑顺序——「早报 | 8月10日 X」、
 * 「8月10日早报：X」、「早报X」都会剥到同一个 X。锚定也是它不会误伤正题的
 * 原因：只有长得像前缀的开头才会被吃掉，正题里的日期与竖线一概不动。
 */
/**
 * 「一小段短文字 + 竖线 + 日期」——凡是长这样的开头都是栏目名，不管它叫什么。
 *
 * 单靠栏目名清单挡不住翻译器：同一句「早报」被 Google Translate 译成过
 * Morning Report / Daily Briefing / Morning Post，穷举必然漏。**必须**用
 * 「后面跟着日期」这个前瞻做守卫，否则「比特币震荡｜黄金新高」这种正题里
 * 自带竖线的标题会被从中间切掉。
 */
const NAMED_COLUMN_HEAD = String.raw`[|｜]\s*(?=\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))`;

const HEAD_TOKENS: Record<BriefingLocale, RegExp[]> = {
  "zh-CN": [
    /^(?:每日)?(?:早报|晨报|日报|周报|简报|快报|要闻速览|市场速览)/,
    new RegExp(String.raw`^[^。！？，,、|｜]{1,12}\s*${NAMED_COLUMN_HEAD}`, "i"),
    /^\d{1,2}\s*月\s*\d{1,2}\s*日/,
    /^\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?/,
    /^[\s|｜:：,，、\-–—·]+/,
  ],
  "en-US": [
    // 英文这条**必须**要求后面跟着分隔符或数字：不加这个前瞻的话，
    // "Report shows CPI cooled" 会被剥成 "shows CPI cooled"。中文没这个问题
    //（正题以「早报」开头的标题不存在），所以中文那条不加限制。
    /^(?:the\s+)?(?:daily|morning|market)?\s*(?:briefing|brief|report|digest|roundup|wrap)(?![a-z])(?=\s*(?:[|｜:,\-–—·]|\d))/i,
    new RegExp(String.raw`^[A-Za-z][A-Za-z .'&]{0,24}\s*${NAMED_COLUMN_HEAD}`, "i"),
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/i,
    /^\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{4})?/i,
    /^\d{4}-\d{2}-\d{2}/,
    /^[\s|｜:,\-–—·]+/,
  ],
};

/**
 * 从任意标题里取出「正题」——去掉栏目名与日期之后剩下的那句话。
 *
 * 剥不出东西时返回原标题（去掉首尾空白）。宁可让一个怪标题带上标准前缀，
 * 也不能产出一个只有「早报 | 8月10日」的空标题。
 */
export function briefingTitleSubject(raw: string, locale: BriefingLocale): string {
  let s = raw.trim();
  const tokens = HEAD_TOKENS[locale];
  // 每轮至少吃掉一个字符，吃不动就停；上限只是防御，正常两三轮就收敛
  for (let i = 0; i < 8; i++) {
    let matched = false;
    for (const re of tokens) {
      const m = re.exec(s);
      if (m && m[0].length > 0) {
        s = s.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return s.trim() || raw.trim();
}

/** 按标准格式拼标题。subject 是正题，不含栏目名与日期 */
export function formatBriefingTitle(
  subject: string,
  dateStr: string,
  locale: BriefingLocale
): string {
  const head = `${PREFIX[locale]} | ${briefingDateLabel(dateStr, locale)}`;
  const body = subject.trim();
  return body ? `${head}${SUBJECT_SEP[locale]}${body}` : head;
}

/**
 * 把模型（或翻译器）给出的标题归一到标准格式。
 *
 * 归一而不是在质量门槛里拒稿，是因为标题格式不对不值得再烧一次模型调用——
 * 门槛每多一条规则，落到零 AI 兜底稿的概率就高一分，而这条规则纯属外观，
 * 代码自己就能修好。日期也一并以我们算出的 dateStr 为准：模型常常照抄
 * prompt 示例里的「8月8日」。
 */
export function normalizeBriefingTitle(
  raw: string,
  dateStr: string,
  locale: BriefingLocale
): string {
  return formatBriefingTitle(briefingTitleSubject(raw, locale), dateStr, locale);
}
