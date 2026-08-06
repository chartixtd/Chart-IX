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
    ],
    allowedAttributes: {},
  });
}
