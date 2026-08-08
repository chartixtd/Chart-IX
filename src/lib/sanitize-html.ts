import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitizer for admin-authored article HTML (produced by the
 * TipTap StarterKit editor in src/app/admin/articles/ArticlesManager.tsx —
 * no Link/Image extensions enabled there, so the allowlist below matches
 * exactly what StarterKit can emit).
 *
 * This must run before the HTML is embedded into the server-rendered page.
 * The previous approach ran DOMPurify.sanitize() inside a "use client"
 * component — during SSR that runs in Node with no `window`, so DOMPurify
 * silently no-ops and the raw, unsanitized DB content shipped straight into
 * the initial HTML document (stored XSS if an admin account is ever
 * compromised or a lower-trust editor role is added later).
 */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "s", "u", "code", "pre",
      "blockquote", "ul", "ol", "li",
      // 每日早报必须标注新闻来源，因此放开链接。属性收得很紧：
      // 只允许 href/rel/target，协议限 http(s)（挡掉 javascript: 伪协议），
      // 且用 transformTags 强制覆写 rel/target——不信任正文里给出的属性值。
      "a",
    ],
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform(
        "a",
        { rel: "nofollow noopener noreferrer", target: "_blank" },
        true
      ),
    },
  });
}
