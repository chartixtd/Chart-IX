/**
 * Google Translate 免费端点。原先内嵌在后台文章翻译路由里，
 * 每日早报的降级阶梯 L3（两语中恰有一语生成失败时翻译另一语）也要用，
 * 故抽取共用。
 */

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
 * Google Translate free endpoint. Returns translated text or null on failure.
 * Handles newlines by temporarily replacing them so they survive translation.
 */
export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string | null> {
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
    if (!res.ok) return null;

    const data = await res.json();

    // Response format: [[["translated","original",...],...],...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown[]) =>
          seg && typeof seg[0] === "string" ? seg[0] : ""
        )
        .join("");

      if (translated) {
        // Restore newlines
        return translated.replace(new RegExp(NL_MARKER.replace(/[\[\]]/g, "\\$&"), "g"), "\n");
      }
    }

    return null;
  } catch {
    return null;
  }
}
