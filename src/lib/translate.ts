/**
 * Google Translate 免费端点。原先内嵌在后台文章翻译路由里，
 * 每日早报的降级阶梯 L3（两语中恰有一语生成失败时翻译另一语）也要用，
 * 故抽取共用。行为与原实现完全一致。
 */

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

    const res = await fetch(url);
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
