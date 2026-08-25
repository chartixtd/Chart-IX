/**
 * Google Translate 免费端点。原先内嵌在后台文章翻译路由里，
 * 每日早报的降级阶梯 L3（两语中恰有一语生成失败时翻译另一语）也要用，
 * 故抽取共用。
 */

import { decodeEntities } from "@/lib/rss";

/**
 * 单次翻译的超时上限。
 *
 * 原实现的 fetch 不带 AbortSignal，而 undici 的默认 header/body 超时是 300 秒——
 * 一个挂住的连接能独自吃光整个 serverless 函数。早报的 L3 会**并发**打 15-20 个
 * 请求，run.ts 的墙钟预算只把住进入翻译的入口，进去之后不再约束任何东西，
 * 于是一次挂起就会绕过 L4 兜底稿：被平台掐断时没有 insert、没有心跳、没有告警。
 * 后台文章翻译器走的是同一个函数，此前有完全相同的暴露。
 *
 * 5 秒对一次纯文本翻译足够宽松；超时返回 null，调用方本来就按「翻译失败」处理。
 */
const TRANSLATE_TIMEOUT_MS = 5_000;

/**
 * 一次翻译的结果。失败时带上**为什么**。
 *
 * 加 reason 不是为了好看：早报英文版降级时，诊断里只有一行「en-US 翻译失败」——
 * 端点封禁、超时、返回体形状变了，这三种处置完全不同的故障在日志里长得一模一样，
 * 每次都得重新猜。gtx 是无鉴权的免费端点，对数据中心 IP（Vercel 的 serverless
 * 出口正是）返回 429 拦截页是常态而不是意外，必须一眼能认出来。
 */
export type TranslateResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Google Translate free endpoint. Returns translated text or null on failure.
 * Handles newlines by temporarily replacing them so they survive translation.
 *
 * 只关心「有没有译文」的调用方用这个；要把失败原因写进诊断的用
 * {@link translateTextDetailed}。
 */
export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string | null> {
  const res = await translateTextDetailed(text, fromLang, toLang);
  return res.ok ? res.text : null;
}

/** 同 {@link translateText}，但失败时给出可写进诊断的原因 */
export async function translateTextDetailed(
  text: string,
  fromLang: string,
  toLang: string
): Promise<TranslateResult> {
  // Protect newlines: replace \n with a marker Google Translate won't strip.
  // Using full-width brackets + "NL" – treated as a non-translatable token.
  const NL_MARKER = "［" + "NL" + "］"; // 【NL】using full-width brackets
  const prepared = text.replace(/\n/g, NL_MARKER);

  try {
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t` +
      `&q=${encodeURIComponent(prepared)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const data = await res.json();

    // Response format: [[["translated","original",...],...],...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown[]) =>
          seg && typeof seg[0] === "string" ? seg[0] : ""
        )
        .join("");

      if (translated) {
        // Restore newlines, then decode HTML entities: gtx 端点会把撇号/引号
        // 编成 &#39; / &quot; 返回。不解码的话，下游 renderBriefingHtml 的
        // escapeHtml 会把 & 再转义成 &amp;，最终页面上直接显示 "Fed&#39;s"。
        // decodeEntities 与 RSS 解析共用同一实现（rss.ts）。
        return {
          ok: true,
          text: decodeEntities(
            translated.replace(new RegExp(NL_MARKER.replace(/[\[\]]/g, "\\$&"), "g"), "\n")
          ),
        };
      }
      return { ok: false, reason: "返回空译文" };
    }

    return { ok: false, reason: "返回体形状不是 [[[译文,…]]]" };
  } catch (err) {
    // 超时（TimeoutError）与网络错误在这里合流，但两者的处置不同：前者是端点慢，
    // 后者多半是出口被封。名字必须留下来。
    return { ok: false, reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
