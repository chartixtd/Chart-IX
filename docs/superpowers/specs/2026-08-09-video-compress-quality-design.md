# 视频压缩质量优化（录屏内容）设计文档

日期：2026-08-09
状态：已获用户批准

## 背景与问题

后台上传超过 50MB 的视频会在浏览器内用 ffmpeg.wasm 压缩到 42.5MB 以内
（Supabase 免费版 50MB 单文件硬上限，见 `video-compress.ts` 头部注释）。
用户反馈压缩后画面太模糊。

根因不是参数没调好，而是**策略与内容类型错配**。站内视频以 K 线/盘面讲解的
屏幕录制为主（用户确认，典型 10–30 分钟），而现行策略按真人视频校准：

1. 分辨率阈值过高（1080p 要求 ≥2000kbps 才给用），10 分钟以上的视频几乎全部
   被降到 480p——录屏内容里文字与 K 线标注是最先糊掉的。
2. `maxrate = 平均码率` 的严格封顶让关键帧与运动瞬间被掐死，画面周期性变糊。
3. 录屏画面大部分帧静止，编码器对静止帧几乎不花码率——保住分辨率、由静止
   画面自己省码率，才是这类内容的正确取舍方向。现行逻辑方向相反。

约束（用户逐项确认）：
- **不花钱**：不升级 Supabase、不接外部视频托管。50MB 单文件与 1GB 总容量的
  墙都保留（后者迟早要回头处理，本设计不解决，见文末「明确不做」）。
- **耗时不能明显变慢**：现在单线程压缩已经很慢。这排除了"只调参数把分辨率
  提到 1080p"的路线（像素量 ×5，纯单线程不可接受），必须上多线程核心。
- **保留 30fps**（用户明确选择，放弃 20fps 方案）：代价是比 20fps 方案多约
  50% 编码帧数；`MAX_FPS` 做成具名常量，将来嫌慢只动这一个数字。

## 已确认的现状事实（2026-08-09 读码核实）

- `next.config.mjs` 已有 `headers()` 配置（全站安全头 + sw.js 专项），新增一条
  路由级规则即可，无结构性改动。
- ffmpeg 核心从 jsDelivr 加载：`@ffmpeg/core@0.12.10/dist/umd`，经
  `toBlobURL` 转为 blob URL 后传给 `ffmpeg.load()`。多线程核心
  `@ffmpeg/core-mt@0.12.10` 走完全相同的机制，只多一个 `workerURL`。
- 当初刻意选单线程核心，理由是 COOP/COEP 需要全站生效会破坏公开页面的跨源
  资源（原设计文档 2026-08-02 记载）。本设计用**路由级作用域**绕开该顾虑：
  Next.js 的 `headers()` 支持按 `source` 匹配，只给 `/admin` 加头。
- `getVideoMetadata` 用 HTMLVideoElement 读元数据，**只能拿到时长与高度，
  拿不到源帧率**——因此帧率封顶必须用 `-fpsmax`（只降不升），不能用 `-r`
  （对低帧率源会插帧上采样）。`@ffmpeg/core` 0.12.x 基于 ffmpeg n5.x，
  `-fps_max` 可用（注意拼写带下划线；实施时以 `ffmpeg -h` 输出复核）。
- 现行 exec 参数：`scale=-2:height`、`libx264 veryfast`、`b:v = maxrate`、
  `bufsize = 2×b:v`、AAC 96k、`yuv420p`、`+faststart`。

## 设计

### ① 多线程核心（速度盘）

**`next.config.mjs`**：`headers()` 新增一条规则，`source: "/admin/:path*"`
（另一条覆盖 `/admin` 本身，或用合并匹配），加：

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

选 `credentialless` 而非 `require-corp`：后台页面加载 Supabase 存储的封面图等
跨源资源，`require-corp` 要求对端带 CORP 头、会整批拦掉；`credentialless`
以无凭据方式放行 no-cors 资源——Supabase 公开 URL 与签名 URL（query 鉴权）
都不依赖 cookie，行为不变。公开页面完全不受影响。

**`video-compress.ts` 的 `loadFFmpeg()`**：按 `self.crossOriginIsolated` 分支：

- 为真：加载 `@ffmpeg/core-mt@0.12.10`（coreURL/wasmURL/workerURL 三件套，
  同样经 toBlobURL），获得约 3–5 倍编码速度。
- 为假（Safari 不支持 credentialless、或头因故未生效）：走现在的单线程核心，
  行为与今天完全一致。**任何浏览器下功能都不坏，只有快慢之分。**

缓存与失败重试逻辑（`ffmpegInstance`/`ffmpegLoadPromise`）保持现状。

### ② 录屏专用压缩参数（质量盘）

`computeCompressionPlan` 重写，原则从「码率优先定分辨率」反转为
「**分辨率优先，静止画面自己省码率**」：

| 项 | 现行 | 改为 |
|---|---|---|
| 分辨率 | 按码率阈值降档，10min+ 几乎必到 480p | 保留源分辨率、上限 1080p；源 ≤1080p 时**跳过 scale 滤镜**（省一步全帧计算） |
| 帧率 | 跟源 | `-fps_max ${MAX_FPS}`，`MAX_FPS = 30`（只封顶 60fps 源，不上采样） |
| 关键帧间隔 | 默认（250 帧） | `-g 300`（30fps 下 10 秒；静止画面在关键帧之间近零码率，Seek 粒度 10 秒可接受） |
| VBV | `maxrate = b:v`，`bufsize = 2×` | `maxrate = 2×b:v`，`bufsize = 4×b:v`——静止时攒预算、运动瞬间释放；总大小仍由平均码率锚定，85% 目标余量吸收波动 |
| 音频 | 恒 96k 立体声 | 时长 >15 分钟降 64k 单声道（`-ac 1`）；讲解人声无损，省出的 32kbps 在低码率区约等于给画面 +10% |
| 分辨率降档阈值 | 1080:2000 / 720:1200 / 480:500 kbps | **1080:280 / 720:160** kbps（静态内容阈值远低于真人视频），480p 兜底 |
| preset | veryfast | 不变（耗时约束） |

按 42.5MB 预算换算的实际效果（音频按降档后算）：

- **≤ 约 17 分钟：保 1080p**（现在这个区间几乎全落 480p——这是本设计的主要收益区）
- 约 17–27 分钟：720p（精确边界由 356.5Mbit 预算 − 64k 音频对阈值反解，见测试）
- 更长：480p（50MB 内的物理极限，30 分钟视频总码率仅 ~190kbps，任何参数都救不了；
  超长视频的出路是拆分或将来的外部托管）

`computeCompressionPlan` 签名扩为返回 `{ height, videoBitrateKbps,
audioBitrateKbps, audioChannels, maxrateKbps, bufsizeKbps, skipScale }`
，exec 参数全部由 plan 驱动，不在 exec 处二次计算。

### ③ 耗时预期（已向用户明示）

1080p30 像素量 ≈ 现行 480p30 的 5 倍，多线程加速 3–5 倍：8 核以上机器约持平，
弱机器略慢。保 30fps 比 20fps 方案多付约 50% 编码时间——实测不可接受时，
`MAX_FPS` 是唯一要动的旋钮。

### ④ 测试与验收

单元测试（`video-compress.test.ts` 扩展）：

- 分辨率：源 720p 保 720p 不上采样；源 1080p 保 1080p；源 1440p 封到 1080p；
  源即目标高度时 `skipScale` 为真
- 时长分档：5/15/17/18/25/28/30 分钟各落在预期分辨率档；边界值按新阈值断言
- 音频规则：≤15min 96k 立体声，>15min 64k 单声道
- VBV 关系：`maxrate = 2×b:v`、`bufsize = 4×b:v` 恒成立
- 奇数高度取偶、`MIN_VIDEO_KBPS` 下限等现有行为保持（回归）
- 核心选择：`crossOriginIsolated` 真/假各一条（mock `self`），假时必须落单线程

无法单测的部分的验收步骤：

1. 部署后打开任意 `/admin` 页面，控制台 `self.crossOriginIsolated === true`；
   同时抽查一个带 Supabase 封面图的后台页面确认图片仍正常显示（credentialless 生效）
2. 公开页面（首页、文章页）响应头**不含** COOP/COEP
3. 拿一个真实 15–20 分钟 1080p 录屏压一次：对比压缩前后的文字清晰度、
   输出体积 ≤50MB、耗时与优化前同一视频的耗时

## 明确不做（YAGNI）

- 不解决 1GB 总容量问题（外部托管/升级计划是另一个项目）
- 不做两遍编码（耗时翻倍，违反约束）
- 不换更慢的 preset、不加 `-tune`（收益小于耗时代价）
- 不做压缩参数的后台 UI 配置（常量足够，改动走代码）
- 不动上传流程、进度 UI、`/api/admin/videos`（纯 `video-compress.ts` +
  `next.config.mjs` 改动）
