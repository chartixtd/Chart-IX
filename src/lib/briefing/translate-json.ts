import { translateTextDetailed, type TranslateResult } from "@/lib/translate";
import { isLocaleLanguageOk } from "./quality-gate";
import type { BriefingJson, BriefingLocale, BriefingTranslateOutcome } from "./types";

/** 注入点，便于测试；生产路径用 @/lib/translate 的 translateTextDetailed */
export type TranslateFn = (text: string, from: string, to: string) => Promise<TranslateResult>;

/**
 * 同时在飞的翻译请求数。
 *
 * 曾经是 `Promise.all(fields.map(...))`——十几个字段一次全发出去。那版的注释
 * 已经写明了风险（「从单个 serverless IP 朝免费的 gtx 端点突发约 20 个请求，
 * 比 1-2 个串行请求更容易吃到 429」）并说「若日志里真的开始出现 429 再改」。
 * 现在改：本地复现时，这个端点对突发一律回 429 拦截页。
 *
 * 4 是折中。十几个字段分 3-4 波、每波几百毫秒，总耗时仍是一两秒，离
 * MIN_TRANSLATE_BUDGET_MS 很远；而串行（run.ts 的注释反复强调不能退回串行）
 * 会把墙钟预算耗光。
 *
 * 需要说清楚的是：小并发**治不好**根因。gtx 无鉴权，封的是 IP 而不是速率，
 * 数据中心出口被整段拦下时，发 1 个还是 20 个都一样是 429。所以这条通道现在
 * 只是备胎，主路走 translate-model.ts。
 */
const TRANSLATE_CONCURRENCY = 4;

/**
 * 逐字段翻译 BriefingJson（降级阶梯 L3b：模型翻译失败后的备胎）。
 *
 * 为什么**不能**把渲染好的 HTML 整篇丢进 translateText：
 *
 * 1. 体积。translateText 把内容放在 GET 查询串里，中文经 encodeURIComponent
 *    膨胀约 9 倍。实测编码后的 q 参数：零来源的最短早报就有 ~6.6KB（已顶到经典
 *    8KB 请求行上限），60 条来源的典型早报 ~23KB，超限 3 倍。任何非 2xx 都失败，
 *    随后调用方 `?? goodHtml` 会把中文 HTML 原样当成 en-US 发布——正文
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
 * 任一字段翻译失败（失败结果或空串）就整体失败——绝不把另一种语言的正文当成
 * 本语言发布，调用方据此接着往下降级。
 */
export async function translateBriefingJson(
  b: BriefingJson,
  from: string,
  to: string,
  targetLocale: BriefingLocale,
  translate: TranslateFn = translateTextDetailed
): Promise<BriefingTranslateOutcome> {
  const fields: string[] = [
    b.title,
    b.summary,
    ...b.headlines.flatMap((h) => [h.topic, ...h.points]),
    b.analysis.overview,
    b.analysis.crypto,
    b.analysis.gold,
    ...b.analysis.watchlist,
  ];

  const results = await mapWithConcurrency(fields, TRANSLATE_CONCURRENCY, (t) =>
    translate(t, from, to)
  );

  // 失败原因要**聚合**再上报。十几个字段同时撞上 429 时，逐条列出来只是把同一句
  // 话抄十几遍，还会把 Telegram 告警撑爆；而「12 个字段全失败，都是 HTTP 429」
  // 与「只有 1 个失败」指向完全不同的故障，计数必须留下。
  const reasons = results
    .map((r) => (r.ok ? (r.text.trim() ? null : "返回空译文") : r.reason))
    .filter((r): r is string => r !== null);
  if (reasons.length > 0) {
    const tally = new Map<string, number>();
    for (const r of reasons) tally.set(r, (tally.get(r) ?? 0) + 1);
    const detail = [...tally.entries()].map(([r, n]) => `${r}×${n}`).join(", ");
    return {
      ok: false,
      reason: `翻译端点失败 ${reasons.length}/${fields.length} 字段（${detail}）`,
    };
  }
  const out = results.map((r) => (r.ok ? r.text : ""));

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
  if (!isLocaleLanguageOk(assembled, targetLocale)) {
    return { ok: false, reason: `译文语种不符合 ${targetLocale}（端点很可能原样吐回了输入）` };
  }

  return { ok: true, json: { title, summary, headlines, analysis: { overview, crypto, gold, watchlist } } };
}

/** 保序的小并发 map。结果下标与输入下标严格对应——下面的取回完全依赖这一点 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
