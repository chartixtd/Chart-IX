export const COMPRESSION_THRESHOLD_BYTES = 80 * 1024 * 1024;

const TARGET_BYTES = Math.floor(COMPRESSION_THRESHOLD_BYTES * 0.92);
const AUDIO_KBPS = 96;

interface ResolutionStep {
  height: number;
  floorKbps: number;
}

// Ordered highest to lowest — the loop below relies on this order.
const RESOLUTION_STEPS: ResolutionStep[] = [
  { height: 1080, floorKbps: 2000 },
  { height: 720, floorKbps: 1200 },
  { height: 480, floorKbps: 500 },
];

export interface CompressionPlan {
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  estimatedBytes: number;
  stillOverLimit: boolean;
}

export function needsCompression(fileSizeBytes: number): boolean {
  return fileSizeBytes > COMPRESSION_THRESHOLD_BYTES;
}

/**
 * Picks the highest resolution the size-budget bitrate can support at an
 * acceptable quality floor for that resolution. If even the lowest floor
 * (480p @ 500kbps) doesn't fit the 80MB budget, the floor bitrate is used
 * anyway and `stillOverLimit` is set — callers must not treat that as an
 * error, only as a warning to surface.
 */
export function computeCompressionPlan(durationSeconds: number, sourceHeight: number): CompressionPlan {
  const targetTotalKbps = (TARGET_BYTES * 8) / (1000 * durationSeconds);
  const rawVideoKbps = targetTotalKbps - AUDIO_KBPS;

  const lowestStep = RESOLUTION_STEPS[RESOLUTION_STEPS.length - 1];
  let chosenStep = lowestStep;
  for (const step of RESOLUTION_STEPS) {
    if (step.height <= sourceHeight && rawVideoKbps >= step.floorKbps) {
      chosenStep = step;
      break;
    }
  }

  const videoBitrateKbps = Math.round(Math.max(rawVideoKbps, chosenStep.floorKbps));
  const height = Math.min(chosenStep.height, sourceHeight);
  const estimatedBytes = Math.ceil(((videoBitrateKbps + AUDIO_KBPS) * 1000 * durationSeconds) / 8);

  return {
    height,
    videoBitrateKbps,
    audioBitrateKbps: AUDIO_KBPS,
    estimatedBytes,
    stillOverLimit: estimatedBytes > COMPRESSION_THRESHOLD_BYTES,
  };
}

interface VideoMetadata {
  durationSeconds: number;
  height: number;
}

function getVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
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
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load video file for compression"));
    };
    video.src = url;
  });
}

let ffmpegInstance: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoadPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

// Single-threaded core (no COOP/COEP headers required) — see Global Constraints.
const FFMPEG_CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

async function loadFFmpeg(): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
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
  ffmpeg.on("progress", handleProgress);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    await ffmpeg.exec([
      "-i", inputName,
      "-vf", `scale=-2:${plan.height}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-b:v", `${plan.videoBitrateKbps}k`,
      "-maxrate", `${plan.videoBitrateKbps}k`,
      "-bufsize", `${plan.videoBitrateKbps * 2}k`,
      "-c:a", "aac",
      "-b:a", `${plan.audioBitrateKbps}k`,
      outputName,
    ]);

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
