import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitizer for admin-authored article HTML (produced by the
 * TipTap editor in src/app/admin/articles/ArticleEditors.tsx — StarterKit
 * plus the Image extension, so the allowlist below matches exactly what
 * those can emit).
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
      // 正文配图（后台编辑器上传后拿到的公开 URL）。属性同样收紧：只留
      // src/alt/title，src 受下面 allowedSchemes 约束，data: 与 javascript:
      // 都进不来，onerror 这类事件属性也一律丢弃。
      "img",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target"],
      img: ["src", "alt", "title"],
    },
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
