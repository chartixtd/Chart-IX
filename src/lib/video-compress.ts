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
