# 视频压缩质量优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后台上传的屏幕录制在 50MB 体积上限内不再模糊——保住分辨率而不是保住码率，同时用多线程 ffmpeg 核心把因分辨率提高带来的耗时增量抵消掉。

**Architecture:** 两处改动。① `next.config.mjs` 只给 `/admin` 路由加 COOP/COEP 两个头，使后台文档进入跨源隔离状态，`video-compress.ts` 据此改用多线程 ffmpeg.wasm 核心（不隔离时自动回落单线程，行为与今天一致）。② `computeCompressionPlan` 的取舍方向反转：从「按码率降分辨率」改为「保源分辨率（上限 1080p），由静止画面自己省码率」，配合放宽的 VBV、拉长的关键帧间隔和长视频的单声道音频。所有决策逻辑抽成纯函数，ffmpeg 只负责按参数执行。

**Tech Stack:** TypeScript、Next.js 15（App Router，`next.config.mjs` 的 `headers()`）、`@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/util` 0.12.2、ffmpeg.wasm 核心 `@ffmpeg/core` / `@ffmpeg/core-mt` 0.12.10、vitest。

**设计文档：** `docs/superpowers/specs/2026-08-09-video-compress-quality-design.md`

## Global Constraints

- **不改上传流程、进度 UI、`/api/admin/videos`、数据库、存储桶。** 本计划只碰两个文件的实现（`src/lib/video-compress.ts`、`next.config.mjs`）加各自的测试。`src/app/admin/videos/VideosManager.tsx` 调用的是 `needsCompression(file.size)` 与 `compressVideo(file, onProgress)`，**这两个导出的签名必须保持不变**。
- **体积上限不可突破：** `COMPRESSION_THRESHOLD_BYTES = 50 * 1024 * 1024`，`TARGET_BYTES = Math.floor(COMPRESSION_THRESHOLD_BYTES * 0.85)`（= 44,564,480 字节）。任何改动都不得让输出有超过 50MB 的风险——被 Supabase 以 413 拒绝比画面软一点严重得多。
- **ffmpeg 核心版本固定 `0.12.10`**，单线程与多线程用同一版本号，都从 `https://cdn.jsdelivr.net/npm/@ffmpeg/core{,-mt}@0.12.10/dist/umd` 加载。
- **这个核心是 FFmpeg 5.1（Lavc59.37），不是 6.0。** 已通过下载 wasm 二进制核实：`fps_max` 出现 0 次，`fps_mode` 出现 4 次。**禁止使用 `-fps_max`**——未知选项会让 ffmpeg 直接失败，等于整个上传功能报废。帧率封顶必须走「探测源帧率 → 仅当 >30 时加 `-r 30`」这条路。
- **不做的事（YAGNI，来自设计文档）：** 不做两遍编码、不换更慢的 preset、不加 `-tune`、不做压缩参数的后台 UI、不解决 1GB 总容量问题。
- **常量必须具名导出可测：** `MAX_FPS = 30` 是设计里唯一的「嫌慢就调它」旋钮，必须是具名常量。
- 每个任务结束前跑 `npx vitest run src/lib/video-compress.test.ts`；最后一个任务额外跑全量校验。
- 提交信息用中文，与仓库既有风格一致（`fix(...)` / `feat(...)` / `refactor(...)` 前缀）。

---

## File Structure

| 文件 | 责任 | 本计划中的处置 |
|---|---|---|
| `src/lib/video-compress.ts` | 压缩的全部决策与执行：体积判定、压缩计划计算、源帧率探测与解析、ffmpeg 核心选择、命令行参数拼装、transcode 执行 | 修改。新增 4 个纯函数导出（`computeCompressionPlan` 重写、`parseSourceFps`、`resolveFFmpegCoreConfig`、`buildFFmpegArgs`），`loadFFmpeg`/`compressVideo` 改为消费它们 |
| `src/lib/video-compress.test.ts` | 上述纯函数的单元测试 | 修改。现有 `computeCompressionPlan` 的 4 条用例全部作废（断言的是旧策略下的 480p），需重写 |
| `next.config.mjs` | 站点配置，含 `headers()` | 修改。`headers()` 数组新增两条 `/admin` 作用域规则 |

`video-compress.ts` 目前 191 行，加完约 260 行，仍是一个职责单一的文件（浏览器端视频压缩），不拆分。

**为什么把决策抽成纯函数：** ffmpeg.wasm 在 vitest 里跑不起来（需要 WebAssembly + Worker + 32MB 网络下载），`compressVideo` 本身无法单测。把「算什么参数」和「执行参数」分开之后，全部易错的逻辑都落在可测的纯函数里，`compressVideo` 退化成一段没有分支判断的胶水代码。

---

### Task 1: 重写 `computeCompressionPlan`——保分辨率而非保码率

**Files:**
- Modify: `src/lib/video-compress.ts:1-68`（常量区 + `RESOLUTION_STEPS` + `CompressionPlan` 接口 + `computeCompressionPlan` 函数体）
- Test: `src/lib/video-compress.test.ts:18-43`（`describe("computeCompressionPlan")` 整块重写）

**Interfaces:**
- Consumes: 无（本任务是纯函数改写，不依赖其他任务）
- Produces:
  - `export const MAX_FPS = 30`
  - `export interface CompressionPlan { height: number; skipScale: boolean; videoBitrateKbps: number; maxrateKbps: number; bufsizeKbps: number; audioBitrateKbps: number; audioChannels: number; gopSize: number }`
  - `export function computeCompressionPlan(durationSeconds: number, sourceHeight: number): CompressionPlan`
  - Task 4 的 `buildFFmpegArgs` 消费整个 `CompressionPlan`；Task 4、5 都引用 `MAX_FPS`。
- 保持不变（不要动）：`COMPRESSION_THRESHOLD_BYTES`、`needsCompression`。

**背景（实施者需要知道的）：**
现行逻辑先按体积预算算出可用码率，再拿码率去查一张「真人视频」标定的表（1080p 要 2000kbps、720p 要 1200kbps），结果 10 分钟以上的录屏一律掉到 480p。但录屏画面绝大部分帧是静止的，x264 对静止帧几乎不花码率——保住分辨率、让静止画面自己省码率才是对的方向。所以阈值要大幅下调（1080p 只要 280kbps、720p 只要 160kbps），并且第一档不是固定的 1080，而是**源分辨率本身**（封顶 1080p），否则一个 900p 的源会被无谓地降到 720p。

预算换算（`TARGET_BYTES * 8 = 356,515,840` 比特，除以时长得到总码率 kbps，再减去音频）：
- ≤ 1036 秒（约 17.3 分钟）→ 保源分辨率（封顶 1080p）
- 1037–1591 秒（约 17.3–26.5 分钟）→ 720p
- ≥ 1592 秒 → 480p（50MB 内的物理极限，参数救不了，出路是拆分视频）

- [ ] **Step 1: 重写测试（先写失败的测试）**

把 `src/lib/video-compress.test.ts` 里现有的整个 `describe("computeCompressionPlan", ...)` 块（第 18–43 行）**删除**，替换为下面这一块。`describe("needsCompression", ...)`（第 4–16 行）原样保留。同时把文件第 1–2 行的 import 改成：

```ts
import { describe, it, expect } from "vitest";
import {
  COMPRESSION_THRESHOLD_BYTES,
  needsCompression,
  computeCompressionPlan,
  MAX_FPS,
} from "./video-compress";
```

新的测试块：

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：多条失败。`skipScale`/`maxrateKbps`/`bufsizeKbps`/`audioChannels`/`gopSize` 在 `CompressionPlan` 上还不存在（TypeScript 报属性不存在），`MAX_FPS` 也还没导出。

- [ ] **Step 3: 改实现**

把 `src/lib/video-compress.ts` 的第 6–68 行（从 `const TARGET_BYTES` 到 `computeCompressionPlan` 函数结束）整体替换为下面内容。第 1–5 行（文件顶部注释与 `COMPRESSION_THRESHOLD_BYTES`）与 `needsCompression`（第 35–37 行）保持原样。

```ts
const TARGET_BYTES = Math.floor(COMPRESSION_THRESHOLD_BYTES * 0.85);

// 不是画质目标，纯粹是技术下限：保证体积预算的除法在病态长的源上不会给
// ffmpeg 递一个 0 或负数码率。体积预算永远压过它——在允许上传超过体积上限
// 之前，先牺牲画质。
const MIN_VIDEO_KBPS = 100;

// 帧率上限。设计里唯一的「嫌慢就调它」旋钮：改成 20 能省掉三分之一的编码
// 帧数。注意这只是上限，低于它的源不会被插帧上采样（见 buildFFmpegArgs）。
export const MAX_FPS = 30;

// 关键帧间隔 = 10 秒。录屏的静止画面在两个关键帧之间几乎不花码率，拉长间隔
// 直接换成画质；代价是拖动进度条的粒度变成 10 秒，对教学视频可接受。
const GOP_SECONDS = 10;

// 上限而非目标：源低于它就按源走。1080p 以上对录屏没有额外可读性，只是烧码率。
const MAX_HEIGHT = 1080;

const AUDIO_STEREO_KBPS = 96;
const AUDIO_MONO_KBPS = 64;
// 超过这个时长的视频码率已经紧张，把讲解人声降成单声道 64k——听感无损，
// 省下的 32kbps 在这个码率区间相当于给画面加了约 10%。
const AUDIO_MONO_THRESHOLD_SECONDS = 900;

// 保住源分辨率所需的最低视频码率。这是**静态内容**的标定：录屏大部分帧
// 静止，x264 对静止帧几乎不花码率，所以同样的 280kbps 在 1080p 录屏上比在
// 480p 真人视频上还清晰。按真人视频标定（原来是 2000kbps）会让每一个超过
// 10 分钟的录屏都掉到 480p，而文字和 K 线标注恰恰是最先糊掉的东西。
const NATIVE_FLOOR_KBPS = 280;

interface ResolutionStep {
  height: number;
  floorKbps: number;
}

// 保不住源分辨率时的降档序列，从高到低——下面的循环依赖这个顺序。
// 最后一档 floor 为 0，是兜底：再低也只能是它。
const FALLBACK_STEPS: ResolutionStep[] = [
  { height: 720, floorKbps: 160 },
  { height: 480, floorKbps: 0 },
];

export interface CompressionPlan {
  height: number;
  /** 目标高度与源高度相同——此时不需要 scale 滤镜，省掉一遍全帧重采样。 */
  skipScale: boolean;
  videoBitrateKbps: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioBitrateKbps: number;
  audioChannels: number;
  gopSize: number;
}

export function needsCompression(fileSizeBytes: number): boolean {
  return fileSizeBytes > COMPRESSION_THRESHOLD_BYTES;
}

/**
 * 永远精确瞄准体积预算（码率 × 时长 ≈ TARGET_BYTES），所以无论源多长，输出
 * 都能可靠地过 50MB 硬上限。
 *
 * 分辨率的取舍方向是「优先保住源分辨率」而不是「优先喂饱码率」：站内视频是
 * K 线/盘面讲解的屏幕录制，画面大部分时间静止，编码器对静止帧几乎不花码率，
 * 于是保住分辨率的边际成本很低、收益（文字和标注不糊）很高。只有当码率连
 * NATIVE_FLOOR_KBPS 都够不上时才逐级降档。分辨率任何时候都不会反过来把码率
 * 顶到预算之上——被 413 拒绝的上传比软一点的画面严重得多。
 */
export function computeCompressionPlan(durationSeconds: number, sourceHeight: number): CompressionPlan {
  const mono = durationSeconds > AUDIO_MONO_THRESHOLD_SECONDS;
  const audioBitrateKbps = mono ? AUDIO_MONO_KBPS : AUDIO_STEREO_KBPS;
  const audioChannels = mono ? 1 : 2;

  const targetTotalKbps = (TARGET_BYTES * 8) / (1000 * durationSeconds);
  const rawVideoKbps = Math.max(targetTotalKbps - audioBitrateKbps, MIN_VIDEO_KBPS);

  // libx264 要求偶数高度，清掉最低位把奇数向下取偶。
  const nativeHeight = Math.min(sourceHeight, MAX_HEIGHT) & ~1;

  let height = nativeHeight;
  if (rawVideoKbps < NATIVE_FLOOR_KBPS) {
    for (const step of FALLBACK_STEPS) {
      // step.height <= nativeHeight 保证降档只会往下走，绝不上采样。
      // 一个都不匹配（源本来就比 480 还低）时 height 保持 nativeHeight。
      if (step.height <= nativeHeight && rawVideoKbps >= step.floorKbps) {
        height = step.height;
        break;
      }
    }
  }

  const videoBitrateKbps = Math.round(rawVideoKbps);

  return {
    height,
    skipScale: height === sourceHeight,
    videoBitrateKbps,
    // VBV 放宽到平均的 2×/4×。原来 maxrate 等于平均码率，等于把关键帧和运动
    // 瞬间死死掐住，画面会周期性地糊一下；放宽之后静止段攒下的预算可以在运动
    // 瞬间释放，而总体积仍由平均码率锚定（15% 的预算余量足够吸收波动）。
    maxrateKbps: videoBitrateKbps * 2,
    bufsizeKbps: videoBitrateKbps * 4,
    audioBitrateKbps,
    audioChannels,
    gopSize: MAX_FPS * GOP_SECONDS,
  };
}
```

**注意：** 旧的 `RESOLUTION_STEPS` 常量和它上方的注释块要一并删掉——被 `NATIVE_FLOOR_KBPS` + `FALLBACK_STEPS` 取代了。此刻 `compressVideo` 里的 `ffmpeg.exec` 仍在用 `plan.height` 和 `plan.videoBitrateKbps`，这两个字段都还在，所以文件仍然能编译通过；exec 参数在 Task 4/5 才改。

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：全部通过（`needsCompression` 3 条 + 新增 20 条）。任何一条数字对不上都**不要改阈值去迁就测试**——阈值是规格，重算期望值；若确认是期望值算错了，改期望值并在提交信息里说明。

- [ ] **Step 5: 类型检查**

```bash
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-compress.ts src/lib/video-compress.test.ts
git commit -m "feat(video): 压缩策略改为保源分辨率——录屏的文字比码率重要"
```

---

### Task 2: 源帧率解析 `parseSourceFps`

**Files:**
- Modify: `src/lib/video-compress.ts`（在 `computeCompressionPlan` 之后、`getVideoMetadata` 之前新增导出函数）
- Test: `src/lib/video-compress.test.ts`（文件末尾新增 describe 块）

**Interfaces:**
- Consumes: 无
- Produces: `export function parseSourceFps(log: string): number | null` — Task 4 的 `buildFFmpegArgs` 消费它的返回值，Task 5 的 `compressVideo` 调用它。

**背景（为什么需要这个函数）：**
我们想把 60fps 的录屏封到 30fps（省一半编码时间，每帧码率翻倍）。ffmpeg 6.0 有专门的 `-fps_max` 做这件事——**但这个核心是 FFmpeg 5.1**（已下载 wasm 核实：`fps_max` 出现 0 次），用了会让 ffmpeg 因未知选项直接失败。而 `-r 30` 虽然可用，却是双向的：源低于 30fps 时它会**插帧**，把一个 24fps 的源变成 30fps，凭空多出 25% 的编码量——直接违反「不能更慢」这条约束。

`getVideoMetadata` 用 HTMLVideoElement 读元数据，只能拿到时长和高度，拿不到帧率。所以走 ffmpeg 自己：先执行一次没有输出文件的 `ffmpeg -i input`，它会把流信息打到日志再以非 0 退出（`exec` 返回退出码、不抛异常，已核实 `@ffmpeg/ffmpeg` 0.12.15 的类型定义：`exec: (args, timeout?, opts?) => Promise<number>`），从日志里把帧率解析出来。解析不到就返回 `null`，调用方据此完全不加 `-r`——退回今天的行为，安全。

ffmpeg 的流信息行长这样（各字段随源不同会增减，帧率一定在 `, N fps` 这个形状里）：

```
Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 4998 kb/s, 60 fps, 60 tbr, 90k tbn (default)
```

- [ ] **Step 1: 写失败的测试**

在 `src/lib/video-compress.test.ts` 末尾追加：

```ts
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
```

同时把该文件顶部的 import 补上 `parseSourceFps`：

```ts
import {
  COMPRESSION_THRESHOLD_BYTES,
  needsCompression,
  computeCompressionPlan,
  parseSourceFps,
  MAX_FPS,
} from "./video-compress";
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：FAIL，`parseSourceFps is not a function` / TypeScript 报没有该导出。

- [ ] **Step 3: 写实现**

在 `src/lib/video-compress.ts` 中 `computeCompressionPlan` 之后插入：

```ts
// 合理的帧率区间。区间外一律当解析失败处理——宁可不加 -r（退回今天的行为），
// 也不要拿一个离谱的值去做决策。
const MIN_PLAUSIBLE_FPS = 1;
const MAX_PLAUSIBLE_FPS = 1000;

/**
 * 从 `ffmpeg -i <file>` 的日志里读出源视频的帧率。
 *
 * 为什么不用 `-fps_max`：这个 wasm 核心是 FFmpeg 5.1（Lavc59.37），`-fps_max`
 * 是 6.0 才有的选项，传给 5.1 会让 ffmpeg 因未知选项直接失败。而 `-r 30` 是
 * 双向的——源低于 30fps 时它会插帧，凭空增加编码量。所以先探测、只在源确实
 * 高于上限时才封顶。
 *
 * 解析不到返回 null，调用方据此完全不加帧率参数。
 */
export function parseSourceFps(log: string): number | null {
  // ffmpeg 的视频流信息行形如：
  //   Stream #0:0(und): Video: h264, yuv420p, 1920x1080, 4998 kb/s, 60 fps, 60 tbr, 90k tbn
  // 只认 " fps"，不认后面的 tbr/tbn。前面要求逗号+空白，避免撞上别的词尾。
  const match = /,\s*(\d+(?:\.\d+)?)\s*fps\b/.exec(log);
  if (!match) return null;

  const fps = Number.parseFloat(match[1]);
  if (!Number.isFinite(fps) || fps < MIN_PLAUSIBLE_FPS || fps > MAX_PLAUSIBLE_FPS) {
    return null;
  }
  return fps;
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：全部通过（含新增 7 条）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-compress.ts src/lib/video-compress.test.ts
git commit -m "feat(video): 从 ffmpeg 日志解析源帧率——这个核心是 5.1，没有 -fps_max"
```

---

### Task 3: ffmpeg 核心选择 `resolveFFmpegCoreConfig`

**Files:**
- Modify: `src/lib/video-compress.ts:120-121`（`FFMPEG_CORE_BASE_URL` 常量及其注释）
- Test: `src/lib/video-compress.test.ts`（末尾新增 describe 块）

**Interfaces:**
- Consumes: 无
- Produces:
  - `export interface FFmpegCoreConfig { baseUrl: string; multiThreaded: boolean }`
  - `export function resolveFFmpegCoreConfig(crossOriginIsolated: boolean): FFmpegCoreConfig`
  - Task 5 的 `loadFFmpeg` 消费它。
- 删除：`FFMPEG_CORE_BASE_URL`（被 `resolveFFmpegCoreConfig` 取代）。

**背景：**
多线程核心需要 `SharedArrayBuffer`，而 `SharedArrayBuffer` 只在跨源隔离（`crossOriginIsolated === true`）的文档里可用。Task 6 会给 `/admin` 加上使之成立的两个响应头。但 Safari 不支持 `COEP: credentialless`，那里隔离不会成立——所以核心选择必须是运行时判断加自动回落，而不是假设。

**把布尔量作为参数传入而不是在函数里读 `globalThis`**，是为了让这个函数在 vitest（node 环境，没有 `crossOriginIsolated`）里可测，且不需要 stub 全局对象。读全局的那一行放在调用方，简单到不需要测试。

两个核心的文件清单已通过 jsDelivr API 核实（`@ffmpeg/core-mt@0.12.10/dist/umd/` 下确有 `ffmpeg-core.js`、`ffmpeg-core.wasm`、`ffmpeg-core.worker.js`），版本号与现用的单线程核心一致。

- [ ] **Step 1: 写失败的测试**

在 `src/lib/video-compress.test.ts` 末尾追加：

```ts
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
```

同时把 `resolveFFmpegCoreConfig` 加入该文件顶部的 import 列表。

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：FAIL，`resolveFFmpegCoreConfig is not a function`。

- [ ] **Step 3: 写实现**

在 `src/lib/video-compress.ts` 里，把现有的这两行

```ts
// Single-threaded core (no COOP/COEP headers required) — see Global Constraints.
const FFMPEG_CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
```

替换为：

```ts
const FFMPEG_CORE_VERSION = "0.12.10";
const SINGLE_THREAD_CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const MULTI_THREAD_CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${FFMPEG_CORE_VERSION}/dist/umd`;

export interface FFmpegCoreConfig {
  baseUrl: string;
  /** 多线程核心要额外加载 ffmpeg-core.worker.js。 */
  multiThreaded: boolean;
}

/**
 * 选哪个 ffmpeg.wasm 核心。
 *
 * 多线程核心快 3–5 倍，但需要 SharedArrayBuffer，而 SharedArrayBuffer 只在
 * 跨源隔离的文档里可用。next.config.mjs 给 /admin 加了 COOP/COEP 让它成立，
 * 但 Safari 不支持 COEP: credentialless——那里隔离不成立，回落单线程核心，
 * 功能完全正常，只是慢。所以这里是运行时判断，不是假设。
 *
 * 布尔量由调用方传入而不是在这里读 globalThis，纯粹是为了可测。
 */
export function resolveFFmpegCoreConfig(crossOriginIsolated: boolean): FFmpegCoreConfig {
  return crossOriginIsolated
    ? { baseUrl: MULTI_THREAD_CORE_BASE_URL, multiThreaded: true }
    : { baseUrl: SINGLE_THREAD_CORE_BASE_URL, multiThreaded: false };
}
```

`loadFFmpeg` 里现在仍在引用 `FFMPEG_CORE_BASE_URL`，会编译失败——**本步骤同时**把 `loadFFmpeg` 内部那两行改成先取配置：

```ts
    const ffmpeg = new FFmpeg();
    const core = resolveFFmpegCoreConfig(false);
    await ffmpeg.load({
      coreURL: await toBlobURL(`${core.baseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${core.baseUrl}/ffmpeg-core.wasm`, "application/wasm"),
    });
```

写死 `false` 是**故意的临时状态**：本任务只交付「能选」，真正读运行时隔离状态并加载 worker 在 Task 5。这样本任务的行为与今天完全一致（仍是单线程），可以独立验证不回归。

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/video-compress.test.ts
npx tsc --noEmit
```

预期：测试全过，类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-compress.ts src/lib/video-compress.test.ts
git commit -m "refactor(video): 抽出 ffmpeg 核心选择，为多线程核心让路"
```

---

### Task 4: 命令行参数拼装 `buildFFmpegArgs`

**Files:**
- Modify: `src/lib/video-compress.ts`（在 `compressVideo` 之前新增导出函数）
- Test: `src/lib/video-compress.test.ts`（末尾新增 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `CompressionPlan` 与 `MAX_FPS`
- Produces: `export function buildFFmpegArgs(inputName: string, outputName: string, plan: CompressionPlan, sourceFps: number | null): string[]` — Task 5 的 `compressVideo` 调用它。

**背景：**
把参数拼装抽成纯函数，是因为 `compressVideo` 本身在 vitest 里跑不起来（需要 WebAssembly + Worker + 32MB 下载）。所有「什么时候加 `-vf`、什么时候加 `-r`」的分支判断都在这里，全部可测；`compressVideo` 退化成没有分支的胶水。

**参数顺序上必须注意的一点：** `-r` 和 `-vf` 都必须出现在 `-i <input>` **之后**，否则 ffmpeg 会把它们当作输入选项（对输入用 `-r` 意思完全不同：它是「假装输入是这个帧率」，会改变时长）。下面的实现先 push `["-i", inputName]`，其余一律追加在后面，天然满足。

- [ ] **Step 1: 写失败的测试**

在 `src/lib/video-compress.test.ts` 末尾追加：

```ts
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

  it("不需要缩放时完全不加 -vf，省掉一遍全帧重采样", () => {
    expect(PLAN_1080.skipScale).toBe(true);
    expect(buildFFmpegArgs("in.mp4", "out.mp4", PLAN_1080, 30)).not.toContain("-vf");
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
```

同时把 `buildFFmpegArgs` 加入该文件顶部的 import 列表。

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/video-compress.test.ts
```

预期：FAIL，`buildFFmpegArgs is not a function`。

- [ ] **Step 3: 写实现**

在 `src/lib/video-compress.ts` 中 `compressVideo` 之前插入：

```ts
/**
 * 拼 ffmpeg 命令行。
 *
 * 抽成纯函数是因为 compressVideo 本身在测试环境跑不起来（要 WebAssembly +
 * Worker + 32MB 下载）；所有分支判断集中在这里，全部可测。
 *
 * sourceFps 为 null 表示探测失败——此时完全不加帧率参数，退回不做帧率处理的
 * 安全行为。只有源确实高于上限才封顶：`-r` 是双向的，对低帧率源用它会插帧，
 * 凭空增加编码量。
 */
export function buildFFmpegArgs(
  inputName: string,
  outputName: string,
  plan: CompressionPlan,
  sourceFps: number | null
): string[] {
  const args = ["-i", inputName];

  if (sourceFps !== null && sourceFps > MAX_FPS) {
    args.push("-r", String(MAX_FPS));
  }

  if (!plan.skipScale) {
    // -2 让宽度按比例走并自动取偶（libx264 要求偶数宽高）。
    args.push("-vf", `scale=-2:${plan.height}`);
  }

  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", `${plan.videoBitrateKbps}k`,
    "-maxrate", `${plan.maxrateKbps}k`,
    "-bufsize", `${plan.bufsizeKbps}k`,
    "-g", String(plan.gopSize),
    "-c:a", "aac",
    "-b:a", `${plan.audioBitrateKbps}k`,
    "-ac", String(plan.audioChannels),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputName
  );

  return args;
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/video-compress.test.ts
npx tsc --noEmit
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-compress.ts src/lib/video-compress.test.ts
git commit -m "feat(video): 抽出 ffmpeg 参数拼装，-r 只在源帧率超上限时才加"
```

---

### Task 5: 接线——`loadFFmpeg` 用多线程核心，`compressVideo` 走探测 + 新参数

**Files:**
- Modify: `src/lib/video-compress.ts`（`loadFFmpeg` 函数体；`compressVideo` 函数体；新增内部函数 `probeSourceFps`）
- Test: 无新增单测（这一段是胶水代码，分支判断都在 Task 1–4 的纯函数里；正确性由 Task 6 的人工验收覆盖）

**Interfaces:**
- Consumes: `computeCompressionPlan`、`parseSourceFps`、`resolveFFmpegCoreConfig`、`buildFFmpegArgs`（Task 1–4）
- Produces: 无新导出。`compressVideo(file: File, onProgress: (pct: number) => void): Promise<File>` 的**签名保持不变**——`VideosManager.tsx` 依赖它。

- [ ] **Step 1: 让 `loadFFmpeg` 真正读运行时隔离状态并加载 worker**

把 Task 3 里临时写死的 `resolveFFmpegCoreConfig(false)` 改掉。`loadFFmpeg` 内部改成：

```ts
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();

    // crossOriginIsolated 是浏览器全局量；在 SSR/测试环境里不存在，所以要探。
    const isolated =
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    const core = resolveFFmpegCoreConfig(isolated);

    const loadOptions: { coreURL: string; wasmURL: string; workerURL?: string } = {
      coreURL: await toBlobURL(`${core.baseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${core.baseUrl}/ffmpeg-core.wasm`, "application/wasm"),
    };
    if (core.multiThreaded) {
      loadOptions.workerURL = await toBlobURL(
        `${core.baseUrl}/ffmpeg-core.worker.js`,
        "text/javascript"
      );
    }

    await ffmpeg.load(loadOptions);
    ffmpegInstance = ffmpeg;
    return ffmpeg;
```

`ffmpegInstance` / `ffmpegLoadPromise` 的缓存与失败清理逻辑保持原样，不要动。

- [ ] **Step 2: 新增 `probeSourceFps`**

在 `buildFFmpegArgs` 之前插入：

```ts
// 探测日志的收集上限。`ffmpeg -i` 的输出只有一两千字符，这个上限纯粹是防止
// 某个畸形输入让 ffmpeg 疯狂刷屏时把内存吃光。
const PROBE_LOG_MAX_CHARS = 20_000;

/**
 * 跑一次没有输出文件的 `ffmpeg -i input`，从日志里读源帧率。
 *
 * ffmpeg 打完流信息后会以「At least one output file must be specified」非 0
 * 退出——这是预期行为，不是错误。`@ffmpeg/ffmpeg` 0.12.x 的 exec 返回退出码
 * 而不抛异常，所以这里不需要区分成功失败，只管收日志。
 *
 * 任何环节出问题都返回 null，调用方据此不加帧率参数——探测不到的代价只是
 * 60fps 的源不被封顶（回到今天的行为），绝不能因为探测失败就压不了视频。
 */
async function probeSourceFps(
  ffmpeg: import("@ffmpeg/ffmpeg").FFmpeg,
  inputName: string
): Promise<number | null> {
  let log = "";
  const onLog = ({ message }: { message: string }) => {
    if (log.length < PROBE_LOG_MAX_CHARS) log += message + "\n";
  };

  ffmpeg.on("log", onLog);
  try {
    await ffmpeg.exec(["-i", inputName]);
  } catch {
    // exec 以返回码报错、理论上不会抛；真抛了就当探测不到。
    return null;
  } finally {
    ffmpeg.off("log", onLog);
  }

  return parseSourceFps(log);
}
```

- [ ] **Step 3: 改 `compressVideo` 的执行段**

`compressVideo` 里从 `await ffmpeg.writeFile(...)` 到 `await ffmpeg.exec([...])` 这一段改为：

```ts
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // 探测要在挂 progress 监听之前做：探测本身也会触发 progress 事件，会让
    // 进度条先跳一下再归零。
    const sourceFps = await probeSourceFps(ffmpeg, inputName);

    ffmpeg.on("progress", handleProgress);
    await ffmpeg.exec(buildFFmpegArgs(inputName, outputName, plan, sourceFps));
```

相应地，把原来在 `try` 之前的 `ffmpeg.on("progress", handleProgress);` 那一行**删掉**（它现在移到了探测之后）。`finally` 里的 `ffmpeg.off("progress", handleProgress);` 保持原样——重复 off 一个没挂上的监听器是安全的。

其余部分（`readFile`、`Blob`、`new File`、`finally` 里的 `deleteFile`）完全不动。

- [ ] **Step 4: 类型检查与全量测试**

```bash
npx tsc --noEmit
npx vitest run
```

预期：类型检查通过；全量测试通过（数量应为改动前的总数 + 本计划新增的用例数，且没有任何既有用例失败）。

- [ ] **Step 5: 确认没有残留 `-fps_max`**

```bash
grep -rn "fps_max" src/
```

预期：无输出。这个核心是 FFmpeg 5.1，出现即是致命 bug。

- [ ] **Step 6: 提交**

```bash
git add src/lib/video-compress.ts
git commit -m "feat(video): 接上多线程核心与帧率探测，压缩参数全部由 plan 驱动"
```

---

### Task 6: `/admin` 作用域的 COOP/COEP 头 + 全量验证

**Files:**
- Modify: `next.config.mjs:24-50`（`headers()` 返回的数组）

**Interfaces:**
- Consumes: Task 5 的 `loadFFmpeg`——本任务提供的响应头是让 `crossOriginIsolated` 为 true 的前提。
- Produces: 无代码接口。

**背景：**
`SharedArrayBuffer`（多线程核心的前提）只在跨源隔离的文档里可用，而跨源隔离需要 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy`。原设计（2026-08-02）之所以选单线程核心，正是因为担心这两个头全站生效会拦掉公开页面的第三方资源。这里用**路由级作用域**绕开：Next.js 的 `headers()` 按 `source` 匹配，只给 `/admin` 加。

`credentialless` 而不是 `require-corp`：后台会加载 Supabase 存储的封面图，`require-corp` 要求对端回 CORP 头、会整批拦掉；`credentialless` 以无凭据方式放行 no-cors 子资源，而 Supabase 的公开 URL 与签名 URL（鉴权在 query 里）都不依赖 cookie，行为不变。已核实后台没有任何 `<iframe>`（`grep -rn "<iframe" src/app/admin src/components` 无匹配），所以不存在需要一并加头的嵌入文档。

已核实 `/admin` 不走 i18n 前缀（`src/middleware.ts:31` 起对 `pathname.startsWith("/admin")` 单独处理，不进 `intlMiddleware`），所以 `source` 直接写 `/admin` 即可，不需要考虑 `/zh-CN/admin` 之类。

- [ ] **Step 1: 加两条 header 规则**

在 `next.config.mjs` 的 `headers()` 返回数组里，**紧跟在 `source: "/(.*)"` 那一条之后**追加：

```js
      {
        // ffmpeg.wasm 的多线程核心（快 3–5 倍）需要 SharedArrayBuffer，而
        // SharedArrayBuffer 只在跨源隔离的文档里可用，跨源隔离又需要下面这两
        // 个头。视频压缩只发生在后台，所以只给 /admin 加：公开页面不受影响，
        // 也就不会因为 COEP 拦掉第三方图片或嵌入内容——这正是 2026-08-02 那版
        // 设计当初放弃多线程核心的顾虑。
        //
        // credentialless 而不是 require-corp：后台要加载 Supabase 存储的封面图，
        // require-corp 要求对端回 CORP 头、会整批拦掉；credentialless 以无凭据
        // 方式放行 no-cors 子资源，而 Supabase 的公开 URL 与签名 URL（鉴权在
        // query 里）都不依赖 cookie，行为不变。
        //
        // Safari 不支持 credentialless——那里 crossOriginIsolated 为 false，
        // src/lib/video-compress.ts 的 resolveFFmpegCoreConfig 自动回落单线程
        // 核心，功能不坏，只是慢。
        //
        // 两条规则：path-to-regexp 里 "/admin/:path*" 对 "/admin" 本身是否匹配
        // 依赖版本细节，与其赌不如显式各写一条。
        source: "/admin",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
```

- [ ] **Step 2: 全量校验**

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

预期：四项全过。`npm run build` 会解析 `next.config.mjs`，header 配置写错（比如 `source` 不合法）会在这一步报错。

- [ ] **Step 3: 本地验证响应头的作用域**

```bash
npm run dev
```

服务起来后，另开一个终端：

```bash
curl -s -I http://localhost:3000/admin/videos | grep -i "cross-origin"
```

预期：输出 `cross-origin-opener-policy: same-origin` 与 `cross-origin-embedder-policy: credentialless` 两行。
（`/admin/videos` 未登录会 307 跳到 `/admin/login`，头仍应出现在响应上；若没有，用 `-L` 跟随跳转再看。）

```bash
curl -s -I http://localhost:3000/zh-CN | grep -i "cross-origin"
```

预期：**无输出**——公开页面绝不能带上这两个头。若有输出说明 `source` 写宽了，必须修掉再继续。

- [ ] **Step 4: 提交**

```bash
git add next.config.mjs
git commit -m "feat(admin): /admin 作用域加 COOP/COEP，让 ffmpeg 多线程核心可用"
```

- [ ] **Step 5: 部署后的人工验收（需要用户参与，不要代替用户判断结果）**

推送并等 Vercel 部署完成后，请用户依次确认：

1. 打开任意后台页面（如 `/admin/videos`），浏览器控制台执行 `self.crossOriginIsolated`，应为 `true`。为 `false` 则多线程核心不会启用（功能仍正常，只是没提速），需回头查响应头。
2. 同一个后台页面上，Supabase 存储的封面图仍正常显示——这是 `credentialless` 没有误伤跨源资源的证据。
3. 打开公开页面（首页、文章页），页面正常且控制台没有被 COEP 拦截的资源报错。
4. 用一个真实的 15–20 分钟 1080p 录屏走一遍上传：
   - 压缩过程中控制台不出现 `Unrecognized option` 之类的 ffmpeg 报错
   - 输出体积 ≤ 50MB，上传成功
   - 播放时文字/K 线标注比优化前清晰
   - 记录耗时，与优化前同一视频的耗时对比

**若第 4 项的耗时明显变长且用户不接受：** 唯一要动的旋钮是 `src/lib/video-compress.ts` 的 `MAX_FPS`，改成 20 可省掉约三分之一的编码帧数。不要为此回退分辨率策略——那会让本次优化失去意义。

---

## 自检记录

- **设计文档逐节覆盖：** ①多线程核心 → Task 3（选择逻辑）+ Task 5（接线）+ Task 6（响应头）；②压缩参数（分辨率/帧率/GOP/VBV/音频/阈值）→ Task 1（前四项与音频、阈值）+ Task 2、4（帧率）；③耗时预期 → Task 6 Step 5 的验收与回退旋钮；④测试与验收 → 每个任务的测试步骤 + Task 6 Step 3、5。
- **与设计文档的一处偏离（实施中必须按本计划走）：** 设计文档写的是用 `-fps_max` 封顶帧率。写计划时下载了 `@ffmpeg/core-mt@0.12.10` 的 wasm 二进制核实，该核心是 **FFmpeg 5.1（Lavc59.37）**，`fps_max` 出现 **0 次**——`-fps_max` 是 FFmpeg 6.0 才加入的选项，传给 5.1 会因未知选项直接失败，等于每一次压缩都报废。改为「探测源帧率 → 仅当高于 `MAX_FPS` 时加 `-r`」，效果相同且不会对低帧率源插帧。设计文档中「≈17 分钟保 1080p」等结论不受影响。
- **另一处对设计文档的收紧：** 设计文档的分辨率档位表沿用「1080/720/480 三档」的写法，但那样一个 900p 的源在码率充裕时也会被降到 720p。本计划改为「第一档是源分辨率本身（封顶 1080p）」，Task 1 有专门用例（`computeCompressionPlan(300, 900)` 必须得到 900）覆盖。
