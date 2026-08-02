// Supabase's Free plan enforces a hard 50MB-per-file cap project-wide,
// regardless of any bucket-level file size setting — uploads above it are
// rejected with a 413 before our code ever sees them. Target well under
// that (not just under 80MB) so compressed output actually clears it.
export const COMPRESSION_THRESHOLD_BYTES = 50 * 1024 * 1024;

const TARGET_BYTES = Math.floor(COMPRESSION_THRESHOLD_BYTES * 0.85);
const AUDIO_KBPS = 96;
// Not a quality target — purely a technical floor so the byte-budget math
// never hands ffmpeg a zero or negative bitrate for pathologically long
// sources. The byte budget always wins over this; quality is sacrificed
// before the upload is ever allowed to exceed the size cap.
const MIN_VIDEO_KBPS = 100;

interface ResolutionStep {
  height: number;
  floorKbps: number;
}

// Ordered highest to lowest — the loop below relies on this order. These
// floors only steer which resolution looks best at a given bitrate; they
// never push the bitrate itself above what the size budget allows (a
// rejected upload is worse than a softer picture — see MIN_VIDEO_KBPS).
const RESOLUTION_STEPS: ResolutionStep[] = [
  { height: 1080, floorKbps: 2000 },
  { height: 720, floorKbps: 1200 },
  { height: 480, floorKbps: 500 },
];

export interface CompressionPlan {
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

export function needsCompression(fileSizeBytes: number): boolean {
  return fileSizeBytes > COMPRESSION_THRESHOLD_BYTES;
}

/**
 * Always targets the byte budget exactly (bitrate × duration ≈ TARGET_BYTES)
 * so the output reliably clears the hard size cap regardless of source
 * length. Resolution is picked to look as good as possible at whatever
 * bitrate the budget allows — dropping to a lower resolution when the
 * budget is tight makes the same bitrate look better — but resolution
 * never causes the bitrate to exceed the budget.
 */
export function computeCompressionPlan(durationSeconds: number, sourceHeight: number): CompressionPlan {
  const targetTotalKbps = (TARGET_BYTES * 8) / (1000 * durationSeconds);
  const rawVideoKbps = Math.max(targetTotalKbps - AUDIO_KBPS, MIN_VIDEO_KBPS);

  const lowestStep = RESOLUTION_STEPS[RESOLUTION_STEPS.length - 1];
  let chosenStep = lowestStep;
  for (const step of RESOLUTION_STEPS) {
    if (step.height <= sourceHeight && rawVideoKbps >= step.floorKbps) {
      chosenStep = step;
      break;
    }
  }

  const videoBitrateKbps = Math.round(rawVideoKbps);
  // libx264 requires an even height; clear the low bit to round odd values down.
  const height = Math.min(chosenStep.height, sourceHeight) & ~1;

  return {
    height,
    videoBitrateKbps,
    audioBitrateKbps: AUDIO_KBPS,
  };
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
  })().catch((err) => {
    // Clear the cache on failure so a later call retries instead of
    // replaying the same rejected promise forever.
    ffmpegLoadPromise = null;
    throw err;
  });

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
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
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
