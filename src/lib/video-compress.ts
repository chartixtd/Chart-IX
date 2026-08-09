// Supabase's Free plan enforces a hard 50MB-per-file cap project-wide,
// regardless of any bucket-level file size setting — uploads above it are
// rejected with a 413 before our code ever sees them. Target well under
// that (not just under 80MB) so compressed output actually clears it.
export const COMPRESSION_THRESHOLD_BYTES = 50 * 1024 * 1024;

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

interface VideoMetadata {
  durationSeconds: number;
  height: number;
}

const METADATA_TIMEOUT_MS = 30_000;

function getVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read video metadata (timed out)"));
    }, METADATA_TIMEOUT_MS);

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const durationSeconds = video.duration;
      const height = video.videoHeight;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || height <= 0) {
        reject(new Error("Unable to read video duration/resolution"));
        return;
      }
      resolve({ durationSeconds, height });
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load video file for compression"));
    };
    video.src = url;
  });
}

let ffmpegInstance: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoadPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

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

async function loadFFmpeg(): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
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
  })().catch((err) => {
    // Clear the cache on failure so a later call retries instead of
    // replaying the same rejected promise forever.
    ffmpegLoadPromise = null;
    throw err;
  });

  return ffmpegLoadPromise;
}

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

export async function compressVideo(file: File, onProgress: (pct: number) => void): Promise<File> {
  const { fetchFile } = await import("@ffmpeg/util");
  const { durationSeconds, height } = await getVideoMetadata(file);
  const plan = computeCompressionPlan(durationSeconds, height);

  const ffmpeg = await loadFFmpeg();

  const inputExt = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const inputName = `input.${inputExt}`;
  const outputName = "output.mp4";

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
  };

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // 探测要在挂 progress 监听之前做：探测本身也会触发 progress 事件，会让
    // 进度条先跳一下再归零。
    const sourceFps = await probeSourceFps(ffmpeg, inputName);

    ffmpeg.on("progress", handleProgress);
    await ffmpeg.exec(buildFFmpegArgs(inputName, outputName, plan, sourceFps));

    const data = await ffmpeg.readFile(outputName);
    const arrayData = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    const blob = new Blob([arrayData as BlobPart], { type: "video/mp4" });
    const newName = file.name.replace(/\.[^./]+$/, "") + "-compressed.mp4";
    return new File([blob], newName, { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
