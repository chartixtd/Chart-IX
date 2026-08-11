import { describe, it, expect } from "vitest";
import { firstImageSrc, pickCoverFromContent } from "./article-cover";

describe("firstImageSrc", () => {
  it("取第一张图，而不是最后一张", () => {
    const html =
      '<p>a</p><img src="https://cdn.example.com/1.png"><p>b</p><img src="https://cdn.example.com/2.png">';
    expect(firstImageSrc(html)).toBe("https://cdn.example.com/1.png");
  });

  it("属性顺序不影响——src 不一定排在最前", () => {
    expect(firstImageSrc('<img alt="x" title="y" src="https://cdn.example.com/a.png">')).toBe(
      "https://cdn.example.com/a.png"
    );
  });

  it("单引号也认", () => {
    expect(firstImageSrc("<img src='https://cdn.example.com/a.png'>")).toBe(
      "https://cdn.example.com/a.png"
    );
  });

  it("没有图片时返回 null", () => {
    expect(firstImageSrc("<p>纯文字</p>")).toBeNull();
    expect(firstImageSrc("")).toBeNull();
  });

  it("非 http(s) 的 src 不当封面", () => {
    expect(firstImageSrc('<img src="data:image/png;base64,AAAA">')).toBeNull();
    expect(firstImageSrc('<img src="javascript:alert(1)">')).toBeNull();
    expect(firstImageSrc('<img src="/local/relative.png">')).toBeNull();
  });

  it("不会把 <image>、<imgx> 这类当成 img", () => {
    expect(firstImageSrc('<imgx src="https://cdn.example.com/a.png">')).toBeNull();
  });
});

describe("pickCoverFromContent", () => {
  it("按 zh → en → ms 的固定顺序找，不看对象键顺序", () => {
    const content = {
      "ms-MY": '<img src="https://cdn.example.com/ms.png">',
      "en-US": '<img src="https://cdn.example.com/en.png">',
      "zh-CN": '<img src="https://cdn.example.com/zh.png">',
    };
    expect(pickCoverFromContent(content)).toBe("https://cdn.example.com/zh.png");
  });

  it("靠前的语言没有图时顺延到后面的语言", () => {
    const content = {
      "zh-CN": "<p>只有文字</p>",
      "ms-MY": '<img src="https://cdn.example.com/ms.png">',
    };
    expect(pickCoverFromContent(content)).toBe("https://cdn.example.com/ms.png");
  });

  it("三种语言都没有图时返回 null", () => {
    expect(pickCoverFromContent({ "zh-CN": "<p>a</p>", "en-US": "<p>b</p>" })).toBeNull();
    expect(pickCoverFromContent({})).toBeNull();
  });
});
