import { callDeepSeek } from "./deepseek";
import { isLocaleLanguageOk, parseBriefingJson } from "./quality-gate";
import type { BriefingJson, BriefingLocale, BriefingTranslateOutcome } from "./types";

/**
 * 用生成早报的同一个模型来翻译（降级阶梯 L3a）。
 *
 * ## 为什么要有这个文件
 *
 * 英文版此前唯一的来源是 translate.googleapis.com 的 `client=gtx` 端点。那是个
 * **无鉴权的免费端点**，Google 对数据中心 IP 段整体拦截：命中时返回的不是限流
 * 提示而是一张 "Sorry..." HTML 拦截页（HTTP 429），并且**与请求频率无关**——
 * 本地复现时，间隔 1.5 秒的单条串行请求同样每一条都是 429。Vercel 的 serverless
 * 出口正是这类 IP。
 *
 * 也就是说：只要出口 IP 落进被封的段，英文早报**当天必然**掉到零 AI 兜底稿，
 * 而且重试、降并发、加退避全都无效。这个功能上线以来英文版反复降级，根因一直
 * 在这里；此前每一轮修的都是它周边的东西（超时、并发、质量门槛的尺子）。
 *
 * ## 为什么用 DeepSeek 而不是别的翻译服务
 *
 * 它已经在这条流水线里了：有 API key、有鉴权、有 SLA，生成阶段刚跑完一次。
 * 不引入新的凭据、新的账单、新的故障域。翻译的输出量与生成相当而输入更短，
 * 实测生成一次约 9 秒，翻译只会更快。
 *
 * ## 为什么不干脆让模型一次生成两语
 *
 * 试过，被线上推翻：英文原生生成要 24 秒以上且经常返回空，而承载路由只有
 * 60 秒硬上限（见 run.ts 的 PRIMARY_LOCALE 注释）。翻译是**照抄**而非重新写作，
 * 输出 token 少得多，且中文稿已经过完整套质量门槛——译文只需搬运，不需判断。
 */

/**
 * 单次翻译调用的超时。
 *
 * 比生成的 34 秒短：翻译的输入是一篇已经写好的稿（约 1.5k token），输出是它的
 * 等价英文，没有检索、没有取舍。留 22 秒是给「模型偶尔慢一拍」的余量，同时保证
 * 一次失败之后**还来得及**落到 gtx 备胎或兜底稿——这是把它压在生成之下的全部理由。
 */
export const TRANSLATE_MODEL_TIMEOUT_MS = 22_000;

const LANG_NAME: Record<BriefingLocale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

/**
 * 翻译 prompt。
 *
 * 三条约束对应三种真实的翻车方式：
 * 1. **数字必须原样搬运**。质量门槛会拿原稿当基准核对译文里的每个数字
 *    （run.ts 传 `baseline: primary`），模型把 "$64,959.52" 写成 "$64,960"
 *    或把「70亿美元」换算成 "$7.0B" 都会被判成编造，整语掉到兜底稿。
 * 2. **数组长度必须一一对应**。模型很爱把两条要点合并成一条、或顺手补一条。
 *    中英内容必须逐条同构，否则两语各说各话——那正是改成「单次生成 + 翻译」
 *    要消除的东西。下面的 sameShape 会机械地验这一条。
 * 3. **不得添油加醋**。译文里出现原稿没有的判断，等于绕过了原稿刚过完的门槛。
 */
export function buildTranslatePrompt(b: BriefingJson, targetLocale: BriefingLocale): string {
  return `You are a professional financial translator. Translate the json below into ${LANG_NAME[targetLocale]}.

## Rules
- Translate **every** string value. Keep the json structure byte-for-byte identical: same keys, same array lengths, same order.
- Copy every number, price, percentage and ticker symbol **exactly as written**, including the $ sign, the thousands separators and the decimals. Do not round, convert, recompute or re-format them.
- Do not add, drop, merge or reorder any headline, point or watchlist entry.
- Do not add commentary, opinions, disclaimers or facts that are not in the source.
- Write natural, idiomatic ${LANG_NAME[targetLocale]}; do not leave any source-language sentence untranslated.
- Never output a trading recommendation, a price target or a stop-loss level even if you think the source implies one.

## Source json
${JSON.stringify(b, null, 2)}

## Output
Output only the translated json object, with exactly the same shape. No markdown fence, no explanation.`;
}

export interface TranslateModelOptions {
  json: BriefingJson;
  targetLocale: BriefingLocale;
  apiKey: string;
  /** 依次尝试的模型。空内容是 DeepSeek 文档明示的偶发问题，所以同模型重试一次是值得的 */
  models: string[];
  /** 流水线的墙钟终点；每次尝试前都会重新看剩余预算 */
  deadlineMs: number;
  /** 剩余预算低于这个数就不再发起新的调用 */
  minCallBudgetMs: number;
  /** 注入便于测试；生产路径用 deepseek.ts 的 callDeepSeek */
  call?: typeof callDeepSeek;
  /** 每次尝试的耗时会写进这里，供诊断展示——超时值该设多少全靠它 */
  onAttempt?: (message: string) => void;
}

export async function translateBriefingJsonViaModel(
  opts: TranslateModelOptions
): Promise<BriefingTranslateOutcome> {
  const call = opts.call ?? callDeepSeek;
  const prompt = buildTranslatePrompt(opts.json, opts.targetLocale);
  const failures: string[] = [];

  for (const [attempt, model] of opts.models.entries()) {
    const remaining = opts.deadlineMs - Date.now();
    if (remaining < opts.minCallBudgetMs) {
      failures.push(`剩余预算 ${Math.max(0, remaining)}ms 不足以发起第 ${attempt + 1} 次调用`);
      break;
    }

    const startedAt = Date.now();
    const res = await call({
      apiKey: opts.apiKey,
      model,
      prompt,
      // 最后一次尝试也不能跨过 deadline，否则被平台掐断的是那条什么都没写的路径
      timeoutMs: Math.min(TRANSLATE_MODEL_TIMEOUT_MS, remaining),
    });
    const tookMs = Date.now() - startedAt;
    opts.onAttempt?.(`${opts.targetLocale} 第 ${attempt + 1} 次模型翻译(${model}, 耗时 ${tookMs}ms)`);

    if (!res.ok) {
      failures.push(`${model}: ${res.error}`);
      continue;
    }
    // 截断的 json 解析不出来，但 finish_reason 能提前把「为什么解析不出来」说清楚
    if (res.finishReason === "length") {
      failures.push(`${model}: 输出被截断(finish_reason=length)`);
      continue;
    }

    const parsed = parseBriefingJson(res.content);
    if (!parsed) {
      failures.push(`${model}: 返回值不是可解析的 json`);
      continue;
    }
    const shape = sameShape(opts.json, parsed);
    if (shape) {
      failures.push(`${model}: ${shape}`);
      continue;
    }
    // 模型偶尔会「翻译」成原语言——尤其在原文里夹着英文专有名词时。
    // 语种自检用的是质量门槛的同一把尺子，调用方随后还会跑完整的 checkBriefing。
    const assembled = fullText(parsed);
    if (!isLocaleLanguageOk(assembled, opts.targetLocale)) {
      failures.push(`${model}: 译文语种不符合 ${opts.targetLocale}`);
      continue;
    }

    return { ok: true, json: parsed };
  }

  return { ok: false, reason: `模型翻译失败: ${failures.join("; ")}` };
}

/**
 * 译文与原稿的结构必须逐条同构。返回 null 表示一致，否则返回不一致的说明。
 *
 * 这不是洁癖：headlines/points/watchlist 的条数一旦对不上，中英两版就是两篇
 * 不同的稿子，而读者切语言时看到的正是这种"各说各话"。质量门槛只查条数落在
 * 允许区间内，查不出「本来 3 条被并成 2 条」。
 */
function sameShape(src: BriefingJson, out: BriefingJson): string | null {
  if (out.headlines.length !== src.headlines.length) {
    return `headlines 条数 ${out.headlines.length} ≠ 原稿 ${src.headlines.length}`;
  }
  for (const [i, h] of src.headlines.entries()) {
    if (out.headlines[i].points.length !== h.points.length) {
      return `headlines[${i}].points 条数 ${out.headlines[i].points.length} ≠ 原稿 ${h.points.length}`;
    }
  }
  if (out.analysis.watchlist.length !== src.analysis.watchlist.length) {
    return `watchlist 条数 ${out.analysis.watchlist.length} ≠ 原稿 ${src.analysis.watchlist.length}`;
  }
  return null;
}

function fullText(b: BriefingJson): string {
  return [
    b.title,
    b.summary,
    ...b.headlines.flatMap((h) => [h.topic, ...h.points]),
    b.analysis.overview,
    b.analysis.crypto,
    b.analysis.gold,
    ...b.analysis.watchlist,
  ].join("\n");
}
