import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

type Strategy = "static" | "fonts-swr" | "fonts-cache" | "pages" | "never" | "passthrough";
type ShouldCache = (rawUrl: string, mode: string, origin: string) => Strategy;

const ORIGIN = "https://chart-ix.example";
let shouldCache: ShouldCache;

beforeAll(() => {
  const src = readFileSync(new URL("../../../public/sw-strategy.js", import.meta.url), "utf8");
  const scope: { shouldCache?: ShouldCache } = {};
  // sw-strategy.js 把函数挂到传入的作用域上；这里注入一个假的 self，
  // 既拿得到函数，又不污染 globalThis
  new Function("self", src)(scope);
  if (!scope.shouldCache) throw new Error("sw-strategy.js 没有挂载 shouldCache");
  shouldCache = scope.shouldCache;
});

describe("shouldCache", () => {
  it("API 请求绝不缓存", () => {
    expect(shouldCache(`${ORIGIN}/api/screener`, "cors", ORIGIN)).toBe("never");
    expect(shouldCache(`${ORIGIN}/api/trading/order`, "cors", ORIGIN)).toBe("never");
  });

  it("即使是导航模式，API 路径依然不缓存", () => {
    expect(shouldCache(`${ORIGIN}/api/share/abc`, "navigate", ORIGIN)).toBe("never");
  });

  it("带 _rsc 的 RSC payload 绝不缓存", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/dashboard?_rsc=1a2b3c`, "cors", ORIGIN)).toBe("never");
  });

  it("构建产物走 cache-first", () => {
    expect(shouldCache(`${ORIGIN}/_next/static/chunks/main-abc123.js`, "no-cors", ORIGIN)).toBe(
      "static"
    );
  });

  it("图标与 logo 走 cache-first", () => {
    expect(shouldCache(`${ORIGIN}/icons/icon-192.png`, "no-cors", ORIGIN)).toBe("static");
    expect(shouldCache(`${ORIGIN}/logo.png`, "no-cors", ORIGIN)).toBe("static");
  });

  it("Google Fonts 的 CSS 走 stale-while-revalidate", () => {
    expect(shouldCache("https://fonts.googleapis.com/css2?family=Noto+Sans+SC", "cors", ORIGIN)).toBe(
      "fonts-swr"
    );
  });

  it("字体文件本身走 cache-first", () => {
    expect(shouldCache("https://fonts.gstatic.com/s/notosanssc/v1/abc.woff2", "cors", ORIGIN)).toBe(
      "fonts-cache"
    );
  });

  it("页面导航走 network-first", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/articles/hello`, "navigate", ORIGIN)).toBe("pages");
  });

  it("其他跨域请求不拦截", () => {
    expect(shouldCache("https://open-api.bingx.com/openApi/swap/v2/quote/ticker", "cors", ORIGIN)).toBe(
      "passthrough"
    );
  });

  it("同源的非导航、非静态资源请求不拦截", () => {
    expect(shouldCache(`${ORIGIN}/zh-CN/dashboard`, "cors", ORIGIN)).toBe("passthrough");
  });
});
