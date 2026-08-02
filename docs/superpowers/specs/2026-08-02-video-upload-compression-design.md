# Video Upload Client-Side Compression Design

**Goal:** Admin video uploads over 80MB are automatically compressed in the browser before upload, so they never hit the Supabase storage size limit and never error out, with minimal perceptible quality loss.

**Architecture:** Browser-side compression using ffmpeg.wasm, loaded lazily only when needed. Compression runs entirely client-side (in the admin's browser) before the existing signed-URL direct-to-Supabase upload flow, so no server/API changes are needed — this also sidesteps Vercel serverless execution-time and package-size limits that make server-side ffmpeg impractical on this stack.

**Tech Stack:** `@ffmpeg/ffmpeg` + `@ffmpeg/util` (ffmpeg.wasm), used only inside `src/app/admin/videos/VideosManager.tsx` and a new `src/lib/video-compress.ts` helper.

## Global Constraints

- Compression only triggers when `videoFile.size > 80 * 1024 * 1024` (80MB). Files at or under that size skip compression entirely and use the existing upload path unchanged.
- Target size after compression: 80MB × 0.92 (73.6MB), leaving headroom for MP4 container/keyframe overhead so the actual output reliably lands under 80MB.
- Audio is always encoded at a fixed 96kbps AAC — audio's contribution to the size budget is fixed, not computed from source audio bitrate.
- Video bitrate is computed dynamically from `(targetBytes*8 - audioBitrate*durationSeconds) / durationSeconds`, not a fixed compression ratio.
- If the computed video bitrate is too low for the source resolution to look acceptable, the resolution is stepped down (1080p → 720p → 480p) and the bitrate recomputed at each step, so quality degrades gracefully by pairing lower resolution with the available bitrate rather than starving a high resolution.
- If even the lowest resolution/bitrate floor (480p, 500kbps video floor) still produces a file over 80MB (e.g., extremely long source video), the upload is **not blocked** — the compressed file is uploaded as-is, with a UI warning telling the admin the result is still over 80MB and suggesting they trim or split the video.
- No server-side or database changes. `/api/admin/videos` and the storage bucket are untouched — this is purely a pre-upload step in the admin browser.
- ffmpeg.wasm's ~25MB core is loaded lazily (dynamic import), only when a file actually exceeds 80MB, so pages/uploads that never need compression pay no extra download cost.
- Use the **single-threaded** ffmpeg.wasm core (`@ffmpeg/core`, not `@ffmpeg/core-mt`). The multi-threaded core needs `SharedArrayBuffer`, which requires site-wide `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers — this site (`next.config.mjs`) doesn't set them, and adding them globally risks breaking other cross-origin resources on the site (embeds, third-party images/iframes) for the sake of one admin-only feature. Single-threaded is slower but needs no header changes and stays isolated to this feature.

## Components

### `src/lib/video-compress.ts` (new)

A standalone module encapsulating all ffmpeg.wasm interaction, isolated from the React component so it can be reasoned about and tested independently of the upload UI.

Exports:
- `needsCompression(file: File): boolean` — returns `file.size > 80 * 1024 * 1024`.
- `compressVideo(file: File, durationSeconds: number, onProgress: (pct: number) => void): Promise<File>` — runs the full compression pipeline (bitrate calculation, resolution stepping, ffmpeg.wasm transcode) and resolves with a new `File` object (same base name, `.mp4` extension, `video/mp4` type) ready to hand to the existing upload path. Never throws for "still too big after compression" — that's a normal outcome the caller inspects via the returned file's `.size`. It only throws for actual encoding failures (corrupt input, ffmpeg crash), which the caller surfaces as the existing upload error.
- Internally: loads the ffmpeg.wasm core on first use (cached across calls within the same page session), computes target bitrate and resolution per the Global Constraints rules above, writes the input file into ffmpeg's virtual filesystem, runs a two-pass `libx264` encode at the computed bitrate/resolution with `-c:a aac -b:a 96k`, reads back the output, and reports progress via ffmpeg's built-in `progress` event mapped to 0–100.

### `src/app/admin/videos/VideosManager.tsx` (modified)

In the existing `handleUpload` function, right before the current "Get signed upload URL" step:

1. If `needsCompression(videoFile)` is true, switch the progress UI into a "压缩中 X%" phase and call `compressVideo(videoFile, durationSeconds, onProgress)`, using the duration value already collected in the upload form (there's already a `duration` field in this form used for `duration_seconds`).
2. Replace `videoFile` with the compressed result for the rest of the flow (signed URL, PUT, and the `file_size_bytes` sent to `/api/admin/videos` reflects the compressed size, not the original).
3. Once compression finishes, switch the progress UI to the existing "上传中 X%" phase and continue unchanged into the current signed-URL upload logic.
4. If the compressed result is still over 80MB, show a non-blocking warning message (e.g. below the progress bar) stating the compressed size and suggesting the admin trim/split the video — then proceed with the upload exactly as if it were under the limit.
5. If `compressVideo` throws (genuine encoding failure), surface it through the existing `setUploadError` path, same as any other upload failure today.

### Progress UI

The existing single progress bar/percentage in `VideosManager.tsx` gets a phase label alongside the percentage: `压缩中 45%` while compressing, then `上传中 60%` once the compression phase hands off to the current upload logic. No new components — this is a text/state change to the existing progress display.

## Data Flow

```
User selects file
  → size > 80MB?
      no  → (unchanged) createSignedUploadUrl → PUT → POST /api/admin/videos
      yes → lazy-load ffmpeg.wasm
          → compute target bitrate/resolution from duration
          → transcode (progress → "压缩中 X%")
          → still > 80MB? → show warning, continue anyway
          → (unchanged) createSignedUploadUrl → PUT (compressed file) → POST /api/admin/videos
```

## Error Handling

- ffmpeg.wasm fails to load (network issue, unsupported browser — needs `SharedArrayBuffer`/cross-origin isolation): surfaced via `setUploadError` with a clear message; admin can retry or upload manually at reduced size.
- Encoding failure mid-transcode: same `setUploadError` path.
- Compressed-but-still-over-80MB: not an error — a warning, upload proceeds (per Global Constraints).

## Testing

- `src/lib/video-compress.test.ts`: unit tests for the pure bitrate/resolution calculation logic (`needsCompression`, and the internal target-bitrate/resolution-stepping function extracted as a testable pure function) covering: file under threshold skips compression, typical case computes expected bitrate at original resolution, long-duration case steps down resolution, extreme case still exceeds target after floor is hit. The actual ffmpeg.wasm transcode call itself is not unit-tested (no browser WASM runtime in vitest's node environment) — this mirrors the existing pattern in this repo where UI-only/browser-runtime-dependent code is verified manually rather than via automated tests.
