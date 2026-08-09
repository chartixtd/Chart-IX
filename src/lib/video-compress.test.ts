import { describe, it, expect } from "vitest";
import {
  COMPRESSION_THRESHOLD_BYTES,
  needsCompression,
  computeCompressionPlan,
  MAX_FPS,
} from "./video-compress";

describe("needsCompression", () => {
  it("returns false at exactly the 50MB threshold", () => {
    expect(needsCompression(COMPRESSION_THRESHOLD_BYTES)).toBe(false);
  });

  it("returns false below the threshold", () => {
    expect(needsCompression(30 * 1024 * 1024)).toBe(false);
  });

  it("returns true above the threshold", () => {
    expect(needsCompression(COMPRESSION_THRESHOLD_BYTES + 1)).toBe(true);
  });
});

// 预算：TARGET_BYTES = floor(50MiB * 0.85) = 44,564,480 字节 = 356,515,840 比特
// 总码率 kbps = 356,515.84 / 时长秒。下面每条用例的期望值都由该式手算得出。
describe("computeCompressionPlan — 分辨率", () => {
  it("码率充裕时保留源分辨率，不做无谓降档", () => {
    // 900p 源：旧逻辑会掉到 720p（表里没有 900 这一档），新逻辑必须原样保留
    const plan = computeCompressionPlan(300, 900);
    expect(plan.height).toBe(900);
    expect(plan.skipScale).toBe(true);
  });

  it("源就是 1080p 时保留 1080p 并跳过缩放滤镜", () => {
    const plan = computeCompressionPlan(300, 1080);
    expect(plan.height).toBe(1080);
    expect(plan.skipScale).toBe(true);
  });

  it("高于 1080p 的源封顶到 1080p，需要缩放", () => {
    const plan = computeCompressionPlan(300, 1440);
    expect(plan.height).toBe(1080);
    expect(plan.skipScale).toBe(false);
  });

  it("永不上采样：720p 源保持 720p", () => {
    const plan = computeCompressionPlan(300, 720);
    expect(plan.height).toBe(720);
    expect(plan.skipScale).toBe(true);
  });

  it("奇数高度向下取偶（libx264 要求偶数高），并因此需要缩放", () => {
    const plan = computeCompressionPlan(300, 361);
    expect(plan.height).toBe(360);
    expect(plan.skipScale).toBe(false);
  });

  it("1080p 档的下边界：1036 秒仍保 1080p", () => {
    // 356515.84/1036 = 344.127 kbps 总，减 64k 音频 = 280.127 ≥ 280
    const plan = computeCompressionPlan(1036, 1080);
    expect(plan.height).toBe(1080);
    expect(plan.videoBitrateKbps).toBe(280);
  });

  it("1080p 档的下边界外：1037 秒掉到 720p", () => {
    // 356515.84/1037 = 343.795 总，减 64 = 279.795 < 280
    const plan = computeCompressionPlan(1037, 1080);
    expect(plan.height).toBe(720);
    expect(plan.skipScale).toBe(false);
  });

  it("720p 档的下边界：1591 秒仍保 720p", () => {
    // 356515.84/1591 = 224.083 总，减 64 = 160.083 ≥ 160
    const plan = computeCompressionPlan(1591, 1080);
    expect(plan.height).toBe(720);
    expect(plan.videoBitrateKbps).toBe(160);
  });

  it("720p 档的下边界外：1592 秒掉到 480p", () => {
    // 356515.84/1592 = 223.942 总，减 64 = 159.942 < 160
    const plan = computeCompressionPlan(1592, 1080);
    expect(plan.height).toBe(480);
  });

  it("典型 10 分钟录屏现在保住 1080p（旧策略下是 480p——本次优化的主要收益）", () => {
    const plan = computeCompressionPlan(600, 1080);
    expect(plan.height).toBe(1080);
  });

  it("30 分钟视频落到 480p——50MB 内的物理极限，不是 bug", () => {
    const plan = computeCompressionPlan(1800, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(134);
  });

  it("低分辨率源即使码率很紧也不再降档（480 档不得高于源）", () => {
    // 1800 秒 → 码率只够 480p 档，但源只有 360p，必须保持 360
    const plan = computeCompressionPlan(1800, 360);
    expect(plan.height).toBe(360);
  });
});

describe("computeCompressionPlan — 码率与 VBV", () => {
  it("码率严格跟随体积预算", () => {
    // 356515.84/300 = 1188.386 总，减 96 = 1092.386 → 1092
    expect(computeCompressionPlan(300, 1080).videoBitrateKbps).toBe(1092);
  });

  it("maxrate 是平均码率的 2 倍、bufsize 是 4 倍——静止时攒预算，运动瞬间释放", () => {
    const plan = computeCompressionPlan(600, 1080);
    expect(plan.maxrateKbps).toBe(plan.videoBitrateKbps * 2);
    expect(plan.bufsizeKbps).toBe(plan.videoBitrateKbps * 4);
  });

  it("超长视频退到技术最低码率，绝不为了画质突破体积预算", () => {
    const plan = computeCompressionPlan(7200, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(100);
  });

  it("关键帧间隔为 10 秒（MAX_FPS × 10）", () => {
    expect(computeCompressionPlan(600, 1080).gopSize).toBe(MAX_FPS * 10);
  });
});

describe("computeCompressionPlan — 音频", () => {
  it("15 分钟以内保持 96k 立体声", () => {
    const plan = computeCompressionPlan(900, 1080);
    expect(plan.audioBitrateKbps).toBe(96);
    expect(plan.audioChannels).toBe(2);
  });

  it("超过 15 分钟降到 64k 单声道，省出的码率给画面", () => {
    const plan = computeCompressionPlan(901, 1080);
    expect(plan.audioBitrateKbps).toBe(64);
    expect(plan.audioChannels).toBe(1);
    // 356515.84/901 = 395.689 总，减 64 = 331.689 → 332
    expect(plan.videoBitrateKbps).toBe(332);
  });
});
