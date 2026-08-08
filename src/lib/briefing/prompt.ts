import type { BriefingLocale, BriefingSource, MarketFact } from "./types";

/**
 * 单次 prompt 最多塞这么多条新闻，控制输入 token。
 * render.ts 复用同一个常量截断「信息来源」区块——列出的来源必须正好是分析
 * 真正看过的那些，否则文末挂着一串模型从未读到的链接。
 */
export const MAX_SOURCES_IN_PROMPT = 40;

const LANG_INSTRUCTION: Record<BriefingLocale, string> = {
  "zh-CN": "全文使用简体中文作答，不要夹杂英文句子。",
  "en-US": "Write the entire response in English. Do not include Chinese sentences.",
};

/**
 * 构造早报 prompt。
 *
 * 两条硬约束是这个功能能不能用的关键：
 * 1. 数字只能引用下面注入的行情事实——AI 写金融内容最常见的翻车就是编价格，
 *    而质量门槛会拿同一份事实集机械核对 analysis 段落里的每个数字。
 * 2. 不得给出具体买卖点位或仓位建议。
 *
 * DeepSeek 的 JSON 模式要求 prompt 中出现 "json" 一词并给出格式示例，
 * 下面的输出格式段同时满足这两点。
 */
export function buildBriefingPrompt(
  sources: BriefingSource[],
  facts: MarketFact[],
  locale: BriefingLocale,
  dateStr: string
): string {
  const newsBlock = sources
    .slice(0, MAX_SOURCES_IN_PROMPT)
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title}${s.summary ? ` — ${s.summary}` : ""}`)
    .join("\n");

  const factsBlock =
    facts.length > 0
      ? facts
          .map((f) => `${f.label}: 最新价 ${f.lastPrice}，24小时涨跌 ${f.change24hPct}%`)
          .join("\n")
      : "（今日无行情数据，正文中不得出现任何价格或涨跌幅数字）";

  return `你是一名严谨的金融市场编辑，正在为 ${dateStr} 撰写每日市场早报。

${LANG_INSTRUCTION[locale]}

## 素材：过去 24 小时的新闻
${newsBlock}

## 事实：真实行情数据（唯一可引用的数字来源）
${factsBlock}

## 硬性约束
- 正文中出现的所有价格与涨跌幅，**只能**引用上面「事实」段落给出的数值，不得自行推断、回忆或估算任何数字。
- 引用价格时必须写成带美元符号与千分位的形式，例如 $64,959.52。
- **不得**给出具体买卖点位、目标价、止损位或仓位建议。
- **不得**使用「必涨」「稳赚」这类确定性表述。
- 提到黄金时，须说明数据来自黄金代币（XAUT / PAXG），不得表述为伦敦金或 COMEX 黄金期货报价。
- 分析要基于素材做出解读，而不是复述标题。

## 输出格式
只输出一个 json 对象，不要输出任何其他文字。格式示例：

{
  "title": "早报 | 8月8日 比特币小幅上行，黄金续创新高",
  "summary": "一句话导读，20 到 120 字",
  "headlines": [
    { "topic": "加密货币", "points": ["要点一", "要点二"] },
    { "topic": "黄金与大宗", "points": ["要点一"] },
    { "topic": "宏观金融", "points": ["要点一"] }
  ],
  "analysis": {
    "overview": "整体市场解读，80 到 600 字",
    "crypto": "加密市场解读，80 到 600 字",
    "gold": "黄金与大宗解读，80 到 600 字",
    "watchlist": ["今日关注的第一件事", "第二件事"]
  }
}

标题长度须在 10 到 60 字之间。headlines 至少包含 2 个主题。`;
}
