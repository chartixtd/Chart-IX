import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { routing } from "@/i18n/routing";

// sw.js 是纯 JS、不可 import，只能读源码文本提取 LOCALES 字面量。
// 三处硬编码的语言列表（routing.locales / sw.js 的 LOCALES / manifest 测试）
// 一旦漂移，最狠的后果不是显示错了语言，而是 install 时 cache.addAll 整体
// reject——SW 直接装不上，且没有任何可见报错。
describe("public/sw.js 的 LOCALES 与 routing.locales 保持一致", () => {
  it("LOCALES 数组字面量完全匹配", () => {
    const src = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
    const match = src.match(/var LOCALES = (\[[^\]]*\]);/);
    if (!match) throw new Error("sw.js 中找不到 LOCALES 声明");
    // eslint-disable-next-line no-eval
    const swLocales: string[] = eval(match[1]);
    expect(swLocales).toEqual(routing.locales);
  });
});
