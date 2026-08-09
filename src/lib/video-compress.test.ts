import { describe, it, expect } from "vitest";
import {
  COMPRESSION_THRESHOLD_BYTES,
  needsCompression,
  computeCompressionPlan,
  parseSourceFps,
  MAX_FPS,
  resolveFFmpegCoreConfig,
  buildFFmpegArgs,
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

const VIDEO_STREAM_LINE =
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), " +
  "yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 4998 kb/s, 60 fps, 60 tbr, 90k tbn (default)";

describe("parseSourceFps", () => {
  it("从视频流信息行里读出整数帧率", () => {
    expect(parseSourceFps(VIDEO_STREAM_LINE)).toBe(60);
  });

  it("读得出小数帧率（29.97 这类 NTSC 帧率很常见）", () => {
    const line = "  Stream #0:0: Video: h264, yuv420p, 1280x720, 1200 kb/s, 29.97 fps, 29.97 tbr, 90k tbn";
    expect(parseSourceFps(line)).toBe(29.97);
  });

  it("取的是 fps 而不是紧随其后的 tbr", () => {
    const line = "  Stream #0:0: Video: h264, 1920x1080, 24 fps, 90k tbr, 90k tbn";
    expect(parseSourceFps(line)).toBe(24);
  });

  it("在完整的多行日志里也能定位到视频流那一行", () => {
    const log = [
      "ffmpeg version 5.1 Copyright (c) 2000-2022 the FFmpeg developers",
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
      "  Duration: 00:18:03.45, start: 0.000000, bitrate: 5123 kb/s",
      VIDEO_STREAM_LINE,
      "  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s",
      "At least one output file must be specified",
    ].join("\n");
    expect(parseSourceFps(log)).toBe(60);
  });

  it("日志里没有帧率时返回 null——调用方据此完全不加 -r", () => {
    expect(parseSourceFps("At least one output file must be specified")).toBeNull();
  });

  it("空日志返回 null", () => {
    expect(parseSourceFps("")).toBeNull();
  });

  it("荒谬的帧率当作解析失败，不拿去做决策", () => {
    expect(parseSourceFps("Video: h264, 0 fps, 90k tbn")).toBeNull();
    expect(parseSourceFps("Video: h264, 100000 fps, 90k tbn")).toBeNull();
  });
});

describe("resolveFFmpegCoreConfig", () => {
  it("跨源隔离成立时用多线程核心", () => {
    const config = resolveFFmpegCoreConfig(true);
    expect(config.multiThreaded).toBe(true);
    expect(config.baseUrl).toContain("@ffmpeg/core-mt@0.12.10");
  });

  it("未隔离时回落单线程核心——功能不坏，只是慢", () => {
    const config = resolveFFmpegCoreConfig(false);
    expect(config.multiThreaded).toBe(false);
    expect(config.baseUrl).toContain("@ffmpeg/core@0.12.10");
    expect(config.baseUrl).not.toContain("core-mt");
  });

  it("两个核心版本号一致，都指向 umd 构建", () => {
    expect(resolveFFmpegCoreConfig(true).baseUrl).toMatch(/\/dist\/umd$/);
    expect(resolveFFmpegCoreConfig(false).baseUrl).toMatch(/\/dist\/umd$/);
  });
});

// 取某个 flag 的值。ffmpeg 的参数是 [flag, value] 成对出现的扁平数组。
function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const PLAN_1080 = computeCompressionPlan(600, 1080); // 保 1080p，skipScale = true
const PLAN_SCALED = computeCompressionPlan(1800, 1080); // 降到 480p，skipScale = false

describe("buildFFmpegArgs", () => {
  it("输入文件紧跟 -i，输出文件是最后一个参数", () => {
    const args = buildFFmpegArgs("input.mp4", "output.mp4", PLAN_1080, 30);
    expect(valueOf(args, "-i")).toBe("input.mp4");
    expect(args[args.length - 1]).toBe("output.mp4");
  });

  it("需要缩放时按目标高度加 scale；skipScale 时改用宽高取偶而非省略 -vf——避免奇数宽度的源在 libx264 处编码失败", () => {
    expect(PLAN_1080.skipScale).toBe(true);
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, 30);
    expect(args).toContain("-vf");
    expect(valueOf(args, "-vf")).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  });

  it("需要缩放时按目标高度加 scale，宽度按比例取偶", () => {
    expect(PLAN_SCALED.skipScale).toBe(false);
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_SCALED, 30);
    expect(valueOf(args, "-vf")).toBe(`scale=-2:${PLAN_SCALED.height}`);
  });

  it("源帧率高于上限时封顶到 MAX_FPS", () => {
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, 60);
    expect(valueOf(args, "-r")).toBe(String(MAX_FPS));
  });

  it("源帧率等于上限时不加 -r，不做无谓的帧率转换", () => {
    expect(buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, MAX_FPS)).not.toContain("-r");
  });

  it("源帧率低于上限时不加 -r——加了会插帧，凭空增加编码量", () => {
    expect(buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, 24)).not.toContain("-r");
  });

  it("帧率探测失败时不加 -r，退回不做帧率处理的安全行为", () => {
    expect(buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, null)).not.toContain("-r");
  });

  it("绝不使用 -fps_max：这个核心是 FFmpeg 5.1，未知选项会让 ffmpeg 直接失败", () => {
    for (const fps of [null, 24, 30, 60]) {
      expect(buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, fps)).not.toContain("-fps_max");
    }
  });

  it("码率、VBV、关键帧间隔全部取自 plan，不在这里二次计算", () => {
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_SCALED, 30);
    expect(valueOf(args, "-b:v")).toBe(`${PLAN_SCALED.videoBitrateKbps}k`);
    expect(valueOf(args, "-maxrate")).toBe(`${PLAN_SCALED.maxrateKbps}k`);
    expect(valueOf(args, "-bufsize")).toBe(`${PLAN_SCALED.bufsizeKbps}k`);
    expect(valueOf(args, "-g")).toBe(String(PLAN_SCALED.gopSize));
  });

  it("音频码率与声道数取自 plan", () => {
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_SCALED, 30);
    expect(valueOf(args, "-b:a")).toBe(`${PLAN_SCALED.audioBitrateKbps}k`);
    expect(valueOf(args, "-ac")).toBe(String(PLAN_SCALED.audioChannels));
  });

  it("保留既有的编码器与容器设置", () => {
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, 30);
    expect(valueOf(args, "-c:v")).toBe("libx264");
    expect(valueOf(args, "-preset")).toBe("veryfast");
    expect(valueOf(args, "-c:a")).toBe("aac");
    expect(valueOf(args, "-pix_fmt")).toBe("yuv420p");
    expect(valueOf(args, "-movflags")).toBe("+faststart");
  });

  it("-r 和 -vf 都在 -i 之后——放在 -i 之前会被当成输入选项，含义完全不同", () => {
    const args = buildFFmpegArgs("in.mp4", "out.mp4", PLAN_SCALED, 60);
    const inputIdx = args.indexOf("-i");
    expect(args.indexOf("-r")).toBeGreaterThan(inputIdx);
    expect(args.indexOf("-vf")).toBeGreaterThan(inputIdx);
  });
});
