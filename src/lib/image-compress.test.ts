import { describe, it, expect } from "vitest";
import {
  shouldCompress,
  resolveTargetSize,
  replaceExtension,
  compressImage,
  MAX_IMAGE_DIMENSION,
} from "./image-compress";

describe("shouldCompress", () => {
  it("位图才压", () => {
    expect(shouldCompress("image/jpeg")).toBe(true);
    expect(shouldCompress("image/png")).toBe(true);
    expect(shouldCompress("image/webp")).toBe(true);
  });

  it("GIF 不压——过一遍 canvas 只会剩第一帧", () => {
    expect(shouldCompress("image/gif")).toBe(false);
  });

  it("SVG 不压——矢量光栅化反而更大且会糊", () => {
    expect(shouldCompress("image/svg+xml")).toBe(false);
  });
});

describe("resolveTargetSize", () => {
  it("长边超限时等比缩小", () => {
    expect(resolveTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("竖图按高度算长边", () => {
    expect(resolveTargetSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("本来就小于上限的不放大", () => {
    expect(resolveTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("正好等于上限时原样返回", () => {
    expect(resolveTargetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("极端长条也不会缩成 0 像素", () => {
    const r = resolveTargetSize(20000, 3, 1600);
    expect(r.width).toBe(1600);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it("零尺寸不产生 NaN", () => {
    expect(resolveTargetSize(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });

  it("默认上限是 1600", () => {
    expect(resolveTargetSize(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(MAX_IMAGE_DIMENSION).toBe(1600);
  });
});

describe("replaceExtension", () => {
  it("换掉原扩展名", () => {
    expect(replaceExtension("photo.JPG", "webp")).toBe("photo.webp");
  });

  it("文件名里有多个点时只换最后一段", () => {
    expect(replaceExtension("my.photo.2026.png", "webp")).toBe("my.photo.2026.webp");
  });

  it("没有扩展名就补一个", () => {
    expect(replaceExtension("photo", "webp")).toBe("photo.webp");
  });

  it("以点开头的隐藏文件不被截成空名", () => {
    expect(replaceExtension(".gitkeep", "webp")).toBe(".gitkeep.webp");
  });
});

describe("compressImage 的兜底", () => {
  it("不可压的类型原样返回，不碰 canvas", async () => {
    const gif = new File([new Uint8Array([1, 2, 3])], "a.gif", { type: "image/gif" });
    await expect(compressImage(gif)).resolves.toBe(gif);
  });

  it("没有浏览器 API 时原样返回，而不是抛错中断上传", async () => {
    // vitest 跑在 node 环境，既没有 createImageBitmap 也没有 document
    const png = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    await expect(compressImage(png)).resolves.toBe(png);
  });
});
