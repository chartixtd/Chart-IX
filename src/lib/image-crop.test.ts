import { describe, it, expect } from "vitest";
import {
  COVER_ASPECT,
  COVER_OUTPUT_WIDTH,
  COVER_OUTPUT_HEIGHT,
  matchesCoverAspect,
  minCoverScale,
  clampOffset,
  sourceRect,
} from "./image-crop";

const FRAME_W = 640;
const FRAME_H = 360;

describe("matchesCoverAspect", () => {
  it("正好 16:9 的不用裁", () => {
    expect(matchesCoverAspect(1920, 1080)).toBe(true);
    expect(matchesCoverAspect(1600, 900)).toBe(true);
  });

  it("竖图、方图、超宽图都要裁", () => {
    expect(matchesCoverAspect(1080, 1920)).toBe(false);
    expect(matchesCoverAspect(1000, 1000)).toBe(false);
    expect(matchesCoverAspect(3000, 1000)).toBe(false);
  });

  it("差一点点不打断作者——1536x864 是 16:9，1536x1024 不是", () => {
    expect(matchesCoverAspect(1536, 864)).toBe(true);
    expect(matchesCoverAspect(1536, 1024)).toBe(false);
  });

  it("尺寸缺失时按不用裁处理，不阻断上传", () => {
    expect(matchesCoverAspect(0, 0)).toBe(true);
  });
});

describe("minCoverScale", () => {
  it("竖图由宽度决定缩放", () => {
    expect(minCoverScale(1000, 2000, FRAME_W, FRAME_H)).toBeCloseTo(0.64, 6);
  });

  it("超宽图由高度决定缩放", () => {
    expect(minCoverScale(4000, 1000, FRAME_W, FRAME_H)).toBeCloseTo(0.36, 6);
  });

  it("按最小缩放铺开后，两个方向都不小于取景框", () => {
    const [w, h] = [1000, 2000];
    const s = minCoverScale(w, h, FRAME_W, FRAME_H);
    expect(w * s).toBeGreaterThanOrEqual(FRAME_W - 1e-9);
    expect(h * s).toBeGreaterThanOrEqual(FRAME_H - 1e-9);
  });
});

describe("clampOffset", () => {
  it("正数位移会被拉回 0——图片左边不许离开取景框左边", () => {
    expect(clampOffset(50, 1000, FRAME_W)).toBe(0);
  });

  it("拖过头会被顶住下界", () => {
    expect(clampOffset(-9999, 1000, FRAME_W)).toBe(FRAME_W - 1000);
  });

  it("范围内的位移原样保留", () => {
    expect(clampOffset(-120, 1000, FRAME_W)).toBe(-120);
  });

  it("图片不比取景框大时只能是 0", () => {
    expect(clampOffset(-30, 400, FRAME_W)).toBe(0);
  });
});

describe("sourceRect", () => {
  const base = {
    naturalWidth: 1000,
    naturalHeight: 2000,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
  };

  it("竖图按最小缩放居中时，取到的是整幅宽度中的一条", () => {
    const scale = minCoverScale(1000, 2000, FRAME_W, FRAME_H); // 0.64
    const displayedH = 2000 * scale; // 1280
    const r = sourceRect({ ...base, scale, offsetX: 0, offsetY: -(displayedH - FRAME_H) / 2 });
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(1000, 6);
    expect(r.sh).toBeCloseTo(FRAME_H / scale, 6); // 562.5
    expect(r.sy).toBeCloseTo((2000 - FRAME_H / scale) / 2, 6);
  });

  it("拖到顶端时取的是图片最上面那一块", () => {
    const scale = minCoverScale(1000, 2000, FRAME_W, FRAME_H);
    const r = sourceRect({ ...base, scale, offsetX: 0, offsetY: 0 });
    expect(r.sy).toBeCloseTo(0, 6);
  });

  it("拖到底端时取的正好是最后一块，不越界", () => {
    const scale = minCoverScale(1000, 2000, FRAME_W, FRAME_H);
    const displayedH = 2000 * scale;
    const r = sourceRect({ ...base, scale, offsetX: 0, offsetY: FRAME_H - displayedH });
    expect(r.sy + r.sh).toBeCloseTo(2000, 4);
  });

  it("位移越界时结果仍落在原图内", () => {
    const scale = minCoverScale(1000, 2000, FRAME_W, FRAME_H);
    const r = sourceRect({ ...base, scale, offsetX: 9999, offsetY: -99999 });
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.sw).toBeLessThanOrEqual(1000 + 1e-6);
    expect(r.sy + r.sh).toBeLessThanOrEqual(2000 + 1e-6);
  });

  it("放大后取的区域变小——这正是「拉近」的含义", () => {
    const s0 = minCoverScale(1000, 2000, FRAME_W, FRAME_H);
    const a = sourceRect({ ...base, scale: s0, offsetX: 0, offsetY: 0 });
    const b = sourceRect({ ...base, scale: s0 * 2, offsetX: 0, offsetY: 0 });
    expect(b.sw).toBeLessThan(a.sw);
    expect(b.sh).toBeLessThan(a.sh);
  });

  it("取到的区域始终是 16:9，导出才不会变形", () => {
    const scale = minCoverScale(1000, 2000, FRAME_W, FRAME_H);
    const r = sourceRect({ ...base, scale, offsetX: 0, offsetY: -100 });
    expect(r.sw / r.sh).toBeCloseTo(COVER_ASPECT, 6);
  });

  it("scale 为 0 不产生 Infinity 或 NaN", () => {
    const r = sourceRect({ ...base, scale: 0, offsetX: 0, offsetY: 0 });
    expect(Number.isFinite(r.sx)).toBe(true);
    expect(Number.isFinite(r.sw)).toBe(true);
  });
});

describe("导出尺寸", () => {
  it("1600x900，与 image-compress 的长边上限一致", () => {
    expect(COVER_OUTPUT_WIDTH).toBe(1600);
    expect(COVER_OUTPUT_HEIGHT).toBe(900);
    expect(COVER_OUTPUT_WIDTH / COVER_OUTPUT_HEIGHT).toBeCloseTo(COVER_ASPECT, 6);
  });
});
