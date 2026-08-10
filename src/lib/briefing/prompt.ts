import { briefingDateLabel } from "./title";
import type { SourceWithBody } from "./extract";
import type { BriefingLocale, MarketFact } from "./types";

/** 单次 prompt 最多塞这么多条新闻，控制输入 token */
export const MAX_SOURCES_IN_PROMPT = 40;

/**
 * 每段分析的目标字数。
 *
 * 这不是审美偏好，是被输出 token 预算倒推出来的。原本写的是「80 到 600 字」，
 * 三段就能到 1800 字，加上要闻、标题、导读与 JSON 结构开销，中文（约 1 字 1
 * token）轻松越过 DEFAULT_MAX_TOKENS=3000。线上实测就是这么撞上的：
 * finish_reason=length，JSON 截在半截解析不出来，整篇被丢弃、退化成兜底稿。
 *
 * 我让模型去写一个装不下的东西——上限存在，就总有一天会写到上限。
 *
 * **改这两个值必须同步看 deepseek.ts 的 DEFAULT_MAX_TOKENS**，它们是一对；
 * prompt.test.ts 里有一条测试守着这个耦合。
 */
export const SECTION_TARGET_MIN = 150;
export const SECTION_TARGET_MAX = 250;

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
  sources: SourceWithBody[],
  facts: MarketFact[],
  locale: BriefingLocale,
  dateStr: string
): string {
  // 抓到正文的条目给正文，抓不到的退回 RSS 摘要。正文是模型能不能写出「提炼」
  // 而不是「复述标题」的关键——只给标题，产出必然是似曾相识的空话。
  const newsBlock = sources
    .slice(0, MAX_SOURCES_IN_PROMPT)
    .map((s, i) => {
      const detail = s.body || s.summary;
      return `${i + 1}. [${s.source}] ${s.title}${detail ? `\n   正文摘录：${detail}` : ""}`;
    })
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
- 引用涨跌幅时，**方向必须与事实一致**：事实是负数就写「下跌 0.52%」或「-0.52%」，
  绝不能写成「上涨 0.52%」。写成「下跌 -0.52%」这种双重否定也是错的。
- **不得**给出具体买卖点位、目标价、止损位或仓位建议。
- **不得**使用「必涨」「稳赚」这类确定性表述。
- 提到黄金时，须说明数据来自黄金代币（XAUT / PAXG），不得表述为伦敦金或 COMEX 黄金期货报价。
- **分析必须基于上面的正文摘录做出解读，而不是复述标题。** 要点应当说清「发生了什么、
  为什么重要、对市场意味着什么」，读者读完不必再去点开原文。
- 要闻部分按主题归并同类新闻，不要逐条罗列；同一件事被多家报道时合并成一条。

## 输出格式
只输出一个 json 对象，不要输出任何其他文字。格式示例：

{
  "title": "早报 | ${briefingDateLabel(dateStr, locale)} 比特币小幅上行，黄金续创新高",
  "summary": "一句话导读，40 到 80 字",
  "headlines": [
    { "topic": "加密货币", "points": ["要点一", "要点二"] },
    { "topic": "黄金与大宗", "points": ["要点一"] },
    { "topic": "宏观金融", "points": ["要点一"] }
  ],
  "analysis": {
    "overview": "整体市场解读，${SECTION_TARGET_MIN} 到 ${SECTION_TARGET_MAX} 字",
    "crypto": "加密市场解读，${SECTION_TARGET_MIN} 到 ${SECTION_TARGET_MAX} 字",
    "gold": "黄金与大宗解读，${SECTION_TARGET_MIN} 到 ${SECTION_TARGET_MAX} 字",
    "watchlist": ["今日关注的第一件事", "第二件事"]
  }
}

标题长度须在 10 到 60 字之间，并保持「早报 | ${briefingDateLabel(dateStr, locale)} 正题」这个格式。
headlines 至少包含 2 个主题、每个主题 1 到 3 条要点，每条要点一句话。watchlist 2 到 4 条，每条一句话。

**points 与 watchlist 都是字符串数组**，每个元素就是一句话本身，
不要写成 {"title": …, "detail": …} 这样多包一层的对象。

**整个 json 必须写得完整。** 上面给出的字数是目标而非下限，宁可写得紧凑也不要
写到一半被截断——截断的 json 解析不出来，整篇会被丢弃。`;
}
