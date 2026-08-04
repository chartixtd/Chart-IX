(function (scope) {
  /**
   * 唯一的缓存策略事实来源。sw.js 通过 importScripts 载入，
   * 单测通过 new Function 注入假的 self 载入——同一份源码，不会漂移。
   *
   * @param {string} rawUrl
   * @param {string} mode  request.mode
   * @param {string} origin  self.location.origin
   * @returns {"static"|"fonts-swr"|"fonts-cache"|"pages"|"never"|"passthrough"}
   */
  function shouldCache(rawUrl, mode, origin) {
    var url = new URL(rawUrl);
    var sameOrigin = url.origin === origin;

    // ——— 硬规则，必须排在最前 ———
    // 行情、持仓、下单全走 /api。任何一次误缓存都可能让用户基于过期价格做决策。
    if (sameOrigin && url.pathname.indexOf("/api/") === 0) return "never";
    // RSC payload 与构建 ID 强绑定，缓存后遇上新部署会产生偶发的水合错误
    if (sameOrigin && url.searchParams.has("_rsc")) return "never";

    if (url.hostname === "fonts.googleapis.com") return "fonts-swr";
    if (url.hostname === "fonts.gstatic.com") return "fonts-cache";

    if (!sameOrigin) return "passthrough";

    // 内容哈希命名，天然 immutable
    if (url.pathname.indexOf("/_next/static/") === 0) return "static";
    if (url.pathname.indexOf("/icons/") === 0 || url.pathname === "/logo.png") return "static";

    if (mode === "navigate") return "pages";
    return "passthrough";
  }

  scope.shouldCache = shouldCache;
})(typeof self !== "undefined" ? self : globalThis);
