import { describe, it, expect } from "vitest";
import { buildShareExcerpt } from "./community-share";

describe("buildShareExcerpt", () => {
  it("把换行与连续空格折叠成单个空格", () => {
    expect(buildShareExcerpt("第一行\n\n第二行   第三行")).toBe("第一行 第二行 第三行");
  });

  it("去掉首尾空白", () => {
    expect(buildShareExcerpt("  \n 正文 \n  ")).toBe("正文");
  });

  it("短内容原样返回，不加省略号", () => {
    const short = "一句很短的帖子";
    expect(buildShareExcerpt(short)).toBe(short);
  });

  it("超长内容截断，且结果长度正好等于上限", () => {
    const long = "长".repeat(300);
    const out = buildShareExcerpt(long);
    expect(out.length).toBe(160);
    expect(out.endsWith("…")).toBe(true);
  });

  it("恰好等于上限时不截断、不加省略号", () => {
    const exact = "边".repeat(160);
    expect(buildShareExcerpt(exact)).toBe(exact);
  });

  it("自定义上限生效", () => {
    const out = buildShareExcerpt("字".repeat(50), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("空内容返回空串——调用方据此不设 description", () => {
    expect(buildShareExcerpt("")).toBe("");
    expect(buildShareExcerpt("   \n  ")).toBe("");
  });
});
