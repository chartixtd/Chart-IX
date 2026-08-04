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
    // 后台管理页不做移动端/离线适配，不该被缓存；如果缓存了，共用设备上
    // 退出登录后渲染好的后台 HTML（用户列表、操作日志、风控设置）还会残留
    // 在 Cache Storage 里，比缺一份离线体验严重得多，所以直接排除而不是
    // 缓存后再指望每个登出入口都记得去清
    if (sameOrigin && (url.pathname === "/admin" || url.pathname.indexOf("/admin/") === 0)) {
      return "passthrough";
    }

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
