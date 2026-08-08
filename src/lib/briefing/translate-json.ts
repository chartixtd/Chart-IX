import { translateText } from "@/lib/translate";
import { isLocaleLanguageOk } from "./quality-gate";
import type { BriefingJson, BriefingLocale } from "./types";

/** 注入点，便于测试；生产路径用 @/lib/translate 的 translateText */
export type TranslateFn = (text: string, from: string, to: string) => Promise<string | null>;

/**
 * 逐字段翻译 BriefingJson（降级阶梯 L3）。
 *
 * 为什么**不能**把渲染好的 HTML 整篇丢进 translateText：
 *
 * 1. 体积。translateText 把内容放在 GET 查询串里，中文经 encodeURIComponent
 *    膨胀约 9 倍。实测编码后的 q 参数：零来源的最短早报就有 ~6.6KB（已顶到经典
 *    8KB 请求行上限），60 条来源的典型早报 ~23KB，超限 3 倍。任何非 2xx 都返回
 *    null，随后调用方 `?? goodHtml` 会把中文 HTML 原样当成 en-US 发布——正文
 *    回退链是 `content[locale] ?? content["en-US"]`，于是英文**和马来文**读者
 *    都看到中文文章，而运维收到的告警却写着「已用翻译通道兜住」。
 * 2. 正确性。translateText 是纯文本翻译器，喂原始 HTML 会破坏标签与 href。
 *    既有后台翻译器不会撞上，是因为它逐个文本节点翻译；早报是唯一整篇丢进去的。
 *
 * 改成翻译字段后：最长的字段是 analysis 的三段，质量门槛限死 ≤600 字，
 * 编码后约 5.4KB，仍在 8KB 以内；再由调用方拿翻译结果重新走
 * renderBriefingHtml，顺带得到正确的本地化小标题与括号样式（整篇翻译两者都不对），
 * 且价格与链接原样不动。
 *
 * 任一字段翻译失败（null 或空）就整体返回 null——绝不把另一种语言的正文当成
 * 本语言发布，调用方据此落到 L4 兜底稿。
 */
export async function translateBriefingJson(
  b: BriefingJson,
  from: string,
  to: string,
  targetLocale: BriefingLocale,
  translate: TranslateFn = translateText
): Promise<BriefingJson | null> {
  const fields: string[] = [
    b.title,
    b.summary,
    ...b.headlines.flatMap((h) => [h.topic, ...h.points]),
    b.analysis.overview,
    b.analysis.crypto,
    b.analysis.gold,
    ...b.analysis.watchlist,
  ];

  // 并发发出：字段数约 15-20，一天一次的突发量，比串行省下十几个往返；
  // 而 L3 触发时生成阶段可能已经吃掉大半墙钟预算（见 run.ts 的 deadline）。
  const translated = await Promise.all(fields.map((t) => translate(t, from, to)));
  if (translated.some((t) => t === null || t.trim().length === 0)) return null;
  const out = translated as string[];

  // 按与 fields 完全相同的顺序取回，索引显式推进，不依赖对象字面量的求值顺序
  let i = 0;
  const title = out[i++];
  const summary = out[i++];
  const headlines = b.headlines.map((h) => {
    const topic = out[i++];
    const points = h.points.map(() => out[i++]);
    return { topic, points };
  });
  const overview = out[i++];
  const crypto = out[i++];
  const gold = out[i++];
  const watchlist = b.analysis.watchlist.map(() => out[i++]);

  // 翻译器偶尔会原样吐回输入（语种识别失败、限流软失败）。这里再用质量门槛的
  // 同一把尺子兜一道：en-US 必须真的是英文，否则宁可发兜底稿。
  const assembled = [
    title,
    summary,
    ...headlines.flatMap((h) => [h.topic, ...h.points]),
    overview,
    crypto,
    gold,
    ...watchlist,
  ].join("\n");
  if (!isLocaleLanguageOk(assembled, targetLocale)) return null;

  return { title, summary, headlines, analysis: { overview, crypto, gold, watchlist } };
}
