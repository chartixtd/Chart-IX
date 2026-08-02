import { describe, it, expect } from "vitest";
import { COMPRESSION_THRESHOLD_BYTES, needsCompression, computeCompressionPlan } from "./video-compress";

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

describe("computeCompressionPlan", () => {
  it("steps down to 480p and follows the byte budget for a typical 10-minute 1080p source", () => {
    const plan = computeCompressionPlan(600, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(498);
    expect(plan.audioBitrateKbps).toBe(96);
  });

  it("steps down to 720p for a short 1080p source", () => {
    const plan = computeCompressionPlan(200, 1080);
    expect(plan.height).toBe(720);
    expect(plan.videoBitrateKbps).toBe(1687);
  });

  it("never upscales a source below 480p", () => {
    const plan = computeCompressionPlan(300, 360);
    expect(plan.height).toBe(360);
    expect(plan.videoBitrateKbps).toBe(1092);
  });

  it("never exceeds the byte budget — falls to the technical minimum bitrate for an extremely long source rather than inflating past it", () => {
    const plan = computeCompressionPlan(7200, 1080);
    expect(plan.height).toBe(480);
    expect(plan.videoBitrateKbps).toBe(100);
  });
});
