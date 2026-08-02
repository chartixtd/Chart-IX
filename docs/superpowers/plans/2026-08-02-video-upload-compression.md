# Video Upload Client-Side Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin video uploads over 80MB are automatically compressed in the browser (ffmpeg.wasm) before upload, so they never hit the Supabase storage size limit, with minimal perceptible quality loss and no server/API changes.

**Architecture:** A new `src/lib/video-compress.ts` module exposes pure, testable size/bitrate/resolution math plus a browser-only ffmpeg.wasm wrapper. `VideosManager.tsx`'s existing `handleUpload` calls this module before its current signed-URL upload logic, replacing `videoFile` with the compressed result when compression ran.

**Tech Stack:** `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/util@0.12.2` (npm dependencies), `@ffmpeg/core@0.12.10` (single-threaded WASM core, loaded at runtime from the jsDelivr CDN — not an npm dependency, avoids Next.js static-asset bundling of a large binary).

## Global Constraints

- Compression triggers only when `file.size > 80 * 1024 * 1024` (80MB). Files at or under that size use the existing upload path completely unchanged.
- Target output size: `Math.floor(80 * 1024 * 1024 * 0.92)` = 77,175,193 bytes — leaves ~8% headroom for MP4 container/keyframe overhead.
- Audio is always encoded at a fixed 96kbps AAC.
- Video bitrate is computed as `(targetBytes*8)/(1000*durationSeconds) - 96` kbps — dynamic per video, not a fixed ratio.
- Resolution stepping: try 1080p (needs ≥2000kbps), then 720p (needs ≥1200kbps), then 480p (floor: 500kbps), picking the highest resolution the computed bitrate clears. Never upscale past the source's actual resolution.
- If even the 480p floor bitrate (500kbps) produces an estimated size over 80MB (very long source video), do **not** block the upload — use the floor bitrate anyway, mark the result, and show a non-blocking warning in the UI. This is a normal outcome, not an error.
- Use the **single-threaded** ffmpeg.wasm core. Do not add `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers to `next.config.mjs` — this project has none today and adding them site-wide risks breaking other cross-origin resources for the sake of this one admin-only feature.
- Single-pass bitrate-constrained encoding (`-b:v`/`-maxrate`/`-bufsize`), not two-pass — two-pass would double an already slow single-threaded WASM encode for marginal accuracy gain on what is a low-traffic admin path.
- No server-side, database, or `/api/admin/videos` changes. This is purely a pre-upload transform in the admin's browser.
- No React component test harness exists in this repo (established pattern). UI-only changes in `VideosManager.tsx` are verified via `tsc --noEmit` and manual reasoning, not automated tests. Only the pure calculation functions in `video-compress.ts` get unit tests.

---

### Task 1: Pure compression-plan calculation (`needsCompression`, `computeCompressionPlan`)

**Files:**
- Create: `src/lib/video-compress.ts`
- Test: `src/lib/video-compress.test.ts`

**Interfaces:**
- Produces: `COMPRESSION_THRESHOLD_BYTES: number` (= `80 * 1024 * 1024`)
- Produces: `needsCompression(fileSizeBytes: number): boolean`
- Produces: `interface CompressionPlan { height: number; videoBitrateKbps: number; audioBitrateKbps: number; estimatedBytes: number; stillOverLimit: boolean }`
- Produces: `computeCompressionPlan(durationSeconds: number, sourceHeight: number): CompressionPlan`

These are pure functions (no DOM, no ffmpeg) — later tasks build the browser-only wrapper around them.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/video-compress.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { COMPRESSION_THRESHOLD_BYTES, needsCompression, computeCompressionPlan } from "./video-compress";

describe("needsCompression", () => {
  it("returns false at exactly the 80MB threshold", () => {
    expect(needsCompression(COMPRESSION_THRESHOLD_BYTES)).toBe(false);
  });

  it("returns false below the threshold", () => {
    expect(needsCompression(50 * 1024 * 1024)).toBe(false);
  });

  it("returns true above the threshold", () => {
    expect(needsCompression(COMPRESSION_THRESHOLD_BYTES + 1)).toBe(true);
  });
});

describe("computeCompressionPlan", () => {
  it("steps down to 480p and stays under the target for a typical 10-minute 1080p source", () => {
    const plan = computeCompressionPlan(600, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(933);
    expect(plan.audioBitrateKbps).toBe(96);
    expect(plan.estimatedBytes).toBe(77175000);
    expect(plan.stillOverLimit).toBe(false);
  });

  it("keeps source resolution and stays under the target for a short 1080p source", () => {
    const plan = computeCompressionPlan(200, 1080);
    expect(plan.height).toBe(1080);
    expect(plan.videoBitrateKbps).toBe(2991);
    expect(plan.stillOverLimit).toBe(false);
  });

  it("never upscales a source below 480p", () => {
    const plan = computeCompressionPlan(300, 360);
    expect(plan.height).toBe(360);
    expect(plan.videoBitrateKbps).toBe(1962);
    expect(plan.stillOverLimit).toBe(false);
  });

  it("clamps to the 500kbps floor and flags stillOverLimit for an extremely long source", () => {
    const plan = computeCompressionPlan(7200, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(500);
    expect(plan.estimatedBytes).toBe(536400000);
    expect(plan.stillOverLimit).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/video-compress.test.ts`
Expected: FAIL — `video-compress.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement the calculation module**

Create `src/lib/video-compress.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/video-compress.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/video-compress.ts src/lib/video-compress.test.ts
git commit -m "feat(video): add pure compression bitrate/resolution calculation"
```

---

### Task 2: ffmpeg.wasm wrapper (`compressVideo`)

**Files:**
- Modify: `src/lib/video-compress.ts` (append to the file created in Task 1)
- Modify: `package.json` (add dependencies)

**Interfaces:**
- Consumes: `computeCompressionPlan`, `CompressionPlan` from Task 1 (same file)
- Produces: `compressVideo(file: File, onProgress: (pct: number) => void): Promise<File>` — the only export later tasks call. Resolves with a new `File` (MP4, `video/mp4` type). Throws only for genuine failures (can't read metadata, ffmpeg load/exec failure) — "still over 80MB after compression" is **not** a thrown error, it's a normal resolved result the caller inspects via `file.size`.

This task's code runs only in the browser (uses `document.createElement("video")`, dynamic `import()` of ffmpeg.wasm) and is not unit-tested per the Global Constraints — verified manually in Task 4/5.

- [ ] **Step 1: Install dependencies**

```bash
npm install @ffmpeg/ffmpeg@0.12.15 @ffmpeg/util@0.12.2
```

- [ ] **Step 2: Append the metadata reader**

Add to `src/lib/video-compress.ts`:

```typescript
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
```

- [ ] **Step 3: Append the lazy ffmpeg.wasm loader**

Add to `src/lib/video-compress.ts`:

```typescript
import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

// Single-threaded core (no COOP/COEP headers required) — see Global Constraints.
const FFMPEG_CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

async function loadFFmpeg(): Promise<FFmpeg> {
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
```

- [ ] **Step 4: Append `compressVideo`**

Add to `src/lib/video-compress.ts`:

```typescript
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
    const blob = new Blob([arrayData], { type: "video/mp4" });
    const newName = file.name.replace(/\.[^./]+$/, "") + "-compressed.mp4";
    return new File([blob], newName, { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`@ffmpeg/ffmpeg` ships its own types, so `FFmpeg` and the `exec`/`writeFile`/`readFile`/`on`/`off`/`deleteFile` methods should type-check without extra `@types` packages.)

- [ ] **Step 6: Run existing test suite to confirm nothing broke**

Run: `npx vitest run src/lib/video-compress.test.ts`
Expected: PASS — same 7 tests from Task 1 (this task added no new pure-function tests, only browser-only code).

- [ ] **Step 7: Commit**

```bash
git add src/lib/video-compress.ts package.json package-lock.json
git commit -m "feat(video): add ffmpeg.wasm compression wrapper"
```

---

### Task 3: i18n strings for the compression phase and warning

**Files:**
- Modify: `src/i18n/messages/zh-CN.json:577` (after the `"uploading"` key)
- Modify: `src/i18n/messages/en-US.json:577` (after the `"uploading"` key)
- Modify: `src/i18n/messages/ms-MY.json:577` (after the `"uploading"` key)

**Interfaces:**
- Produces: translation keys `admin.videos_list.compressing` and `admin.videos_list.still_over_limit_warning` (with a `{size}` placeholder), consumed by Task 4.

- [ ] **Step 1: Add keys to `zh-CN.json`**

Find this existing line (context from the current file):
```json
      "uploading": "上传中...",
```
Change it to:
```json
      "uploading": "上传中...",
      "compressing": "压缩中...",
      "still_over_limit_warning": "该视频时长较长，压缩后仍为 {size} MB，建议考虑分段或缩短时长。",
```

- [ ] **Step 2: Add keys to `en-US.json`**

Find:
```json
      "uploading": "Uploading...",
```
Change it to:
```json
      "uploading": "Uploading...",
      "compressing": "Compressing...",
      "still_over_limit_warning": "This video is still {size} MB after compression due to its length. Consider trimming or splitting it.",
```

- [ ] **Step 3: Add keys to `ms-MY.json`**

Find:
```json
      "uploading": "Memuat naik...",
```
Change it to:
```json
      "uploading": "Memuat naik...",
      "compressing": "Memampatkan...",
      "still_over_limit_warning": "Video ini masih {size} MB selepas dimampatkan kerana tempohnya. Pertimbangkan untuk memotong atau membahagikan video.",
```

- [ ] **Step 4: Verify JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/messages/zh-CN.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/messages/en-US.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/messages/ms-MY.json','utf8')); console.log('ok')"`
Expected: prints `ok` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(video): add i18n strings for upload compression phase"
```

---

### Task 4: Wire compression into `VideosManager.tsx`'s upload flow

**Files:**
- Modify: `src/app/admin/videos/VideosManager.tsx:157-249` (the `handleUpload` function)
- Modify: `src/app/admin/videos/VideosManager.tsx:37-41` (upload modal state — add one field)
- Modify: `src/app/admin/videos/VideosManager.tsx:564-578` (progress bar JSX)

**Interfaces:**
- Consumes: `needsCompression`, `compressVideo` from `@/lib/video-compress` (Task 1 & 2); translation keys from Task 3.

- [ ] **Step 1: Add a phase state field**

In the "Upload modal state" block (currently lines 38-41):

```typescript
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<"compressing" | "uploading">("uploading");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [sizeWarning, setSizeWarning] = useState("");
```

(This adds `uploadPhase` and `sizeWarning` alongside the existing four fields — nothing existing is removed.)

- [ ] **Step 2: Reset the new state in `resetForm`**

In `resetForm` (currently lines 62-74), add the two new resets alongside the existing ones:

```typescript
  const resetForm = () => {
    setVideoFile(null);
    setLanguage("en-US");
    setTitle("");
    setDescription("");
    setThumbnailUrl("");
    setDuration("");
    setCategoryId("");
    setTier("free");
    setUploadError("");
    setUploadProgress(0);
    setUploadPhase("uploading");
    setSizeWarning("");
    setEditingVideo(null);
  };
```

- [ ] **Step 3: Add the import**

At the top of the file, alongside the other imports (after line 14's `import type { Video, VideoCategory } from "@/types";`):

```typescript
import { needsCompression, compressVideo } from "@/lib/video-compress";
```

- [ ] **Step 4: Insert the compression step in `handleUpload`**

The current `handleUpload` (lines 157-249) starts like this:

```typescript
  const handleUpload = async () => {
    if (!videoFile) {
      setUploadError(t("videos_list.please_select_file"));
      return;
    }
    if (!title.trim()) {
      setUploadError(t("videos_list.title_required_error"));
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadProgress(10);

    try {
      const supabase = createClient();

      // Generate unique filename
      const fileExt = videoFile.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      // Get signed upload URL to bypass Supabase API gateway size limits
      const mimeType = videoFile.type || "video/mp4";
```

Replace it with:

```typescript
  const handleUpload = async () => {
    if (!videoFile) {
      setUploadError(t("videos_list.please_select_file"));
      return;
    }
    if (!title.trim()) {
      setUploadError(t("videos_list.title_required_error"));
      return;
    }

    setUploading(true);
    setUploadError("");
    setSizeWarning("");
    setUploadPhase("uploading");
    setUploadProgress(10);

    try {
      let fileToUpload = videoFile;

      if (needsCompression(videoFile.size)) {
        setUploadPhase("compressing");
        setUploadProgress(0);
        try {
          fileToUpload = await compressVideo(videoFile, (pct) => setUploadProgress(pct));
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : t("videos_list.upload_failed"));
          setUploading(false);
          return;
        }
        if (fileToUpload.size > 80 * 1024 * 1024) {
          setSizeWarning(t("videos_list.still_over_limit_warning", { size: (fileToUpload.size / (1024 * 1024)).toFixed(1) }));
        }
      }

      setUploadPhase("uploading");
      setUploadProgress(10);

      const supabase = createClient();

      // Generate unique filename
      const fileExt = fileToUpload.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      // Get signed upload URL to bypass Supabase API gateway size limits
      const mimeType = fileToUpload.type || "video/mp4";
```

- [ ] **Step 5: Replace remaining `videoFile` references inside `handleUpload` with `fileToUpload`**

Later in the same function (originally around lines 193-229), three more references to `videoFile` need to become `fileToUpload` — everywhere the actual bytes being uploaded or their size are used, **not** the form's `videoFile` state itself (which stays as the original selected file for the "remove file"/preview UI outside `handleUpload`):

```typescript
      const uploadResponse = await fetch(signedData.signedUrl, {
        method: "PUT",
        body: fileToUpload,
        headers: { "Content-Type": mimeType },
      });
```

and further down, in the metadata POST body:

```typescript
          file_size_bytes: fileToUpload.size,
```

Leave every other reference (the file-picker `onChange` handler, the "选择文件/移除文件" preview block, `videoFile.name`/`videoFile.size` shown before upload starts) untouched — those describe the original selection, not what gets uploaded.

- [ ] **Step 6: Update the progress bar JSX**

The current block (lines 564-578):

```typescript
          {/* Upload progress — only for new uploads */}
          {!editingVideo && uploading && uploadProgress > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>{t("videos_list.uploading")}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
```

Replace with:

```typescript
          {/* Upload/compression progress — only for new uploads */}
          {!editingVideo && uploading && (
            <div>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>{uploadPhase === "compressing" ? t("videos_list.compressing") : t("videos_list.uploading")}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          {!editingVideo && sizeWarning && (
            <p className="text-xs text-gold">{sizeWarning}</p>
          )}
```

(Dropped the `uploadProgress > 0` guard since compression now legitimately starts a visible phase at 0%.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/videos/VideosManager.tsx
git commit -m "feat(video): compress oversized uploads in-browser before upload"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 7 new tests from Task 1.

- [ ] **Step 3: Manual smoke test (requires a real browser + a real video file — cannot be scripted)**

Document this checklist in the task report rather than executing it automatically, since it needs a real admin session, a real Supabase project, and real video files:

1. Open the admin videos upload modal with a video file **under** 80MB selected — confirm it uploads exactly as before (no "压缩中" phase ever appears).
2. Select a video file **over** 80MB — confirm the progress label shows "压缩中 X%" counting up, then switches to "上传中 X%", and the upload completes successfully.
3. Confirm the uploaded/played-back video (via the existing video player page) still looks reasonable — no obvious artifacting beyond what's expected from compression.
4. If a very long (e.g., >1 hour) large source file is available, confirm the "该视频时长较长..." warning appears and the upload still completes rather than failing.

- [ ] **Step 4: Report results**

No commit for this task — it's verification of Tasks 1-4's combined result.
