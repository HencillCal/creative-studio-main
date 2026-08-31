import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_QUEUE_THRESHOLD_SECONDS,
  getVideoExportChunkSeconds,
  isVideoExportQueueEnabled,
  shouldQueueVideoExport,
} from "./video-export-queue.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("video export queue policy", () => {
  it("keeps the queue disabled without Redis", () => {
    vi.stubEnv("REDIS_URL", "");
    expect(isVideoExportQueueEnabled()).toBe(false);
  });

  it("queues only exports at or above the configured duration threshold", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    expect(shouldQueueVideoExport(DEFAULT_QUEUE_THRESHOLD_SECONDS - 0.1)).toBe(false);
    expect(shouldQueueVideoExport(DEFAULT_QUEUE_THRESHOLD_SECONDS)).toBe(true);
  });

  it("honors a deployment-specific threshold and clamps chunk sizes", () => {
    vi.stubEnv("VIDEO_QUEUE_THRESHOLD_SECONDS", "600");
    vi.stubEnv("VIDEO_CHUNK_SECONDS", "5");
    expect(shouldQueueVideoExport(599)).toBe(false);
    expect(shouldQueueVideoExport(600)).toBe(true);
    expect(getVideoExportChunkSeconds()).toBe(10);

    vi.stubEnv("VIDEO_CHUNK_SECONDS", "9999");
    expect(getVideoExportChunkSeconds()).toBe(600);
  });

  it("uses the documented default chunk size for invalid values", () => {
    vi.stubEnv("VIDEO_CHUNK_SECONDS", "not-a-number");
    expect(getVideoExportChunkSeconds()).toBe(DEFAULT_CHUNK_SECONDS);
  });
});
