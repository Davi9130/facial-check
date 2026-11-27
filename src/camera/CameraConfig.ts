import type { CameraConfig, CameraOptions } from "../types/camera.types";

export const DEFAULT_CAMERA_CONFIG: Readonly<CameraConfig> = Object.freeze({
  facingMode: "user",
  resolution: Object.freeze({ width: 640, height: 480 }),
  frameRate: 30,
  maxFrameRate: undefined,
  deviceId: undefined,
  fallbackToAnyCamera: true,
});

function assertPositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Camera option "${field}" must be a positive number.`);
  }
}

/** Applies defaults and validates user options. Throws `RangeError` on invalid values. */
export function resolveCameraConfig(options: CameraOptions = {}): CameraConfig {
  const config: CameraConfig = {
    facingMode: options.facingMode ?? DEFAULT_CAMERA_CONFIG.facingMode,
    resolution: { ...(options.resolution ?? DEFAULT_CAMERA_CONFIG.resolution) },
    frameRate: options.frameRate ?? DEFAULT_CAMERA_CONFIG.frameRate,
    maxFrameRate: options.maxFrameRate,
    deviceId: options.deviceId,
    fallbackToAnyCamera: options.fallbackToAnyCamera ?? DEFAULT_CAMERA_CONFIG.fallbackToAnyCamera,
  };

  assertPositive(config.resolution.width, "resolution.width");
  assertPositive(config.resolution.height, "resolution.height");
  assertPositive(config.frameRate, "frameRate");
  if (config.maxFrameRate !== undefined) {
    assertPositive(config.maxFrameRate, "maxFrameRate");
    if (config.maxFrameRate < config.frameRate) {
      throw new RangeError('Camera option "maxFrameRate" must be >= "frameRate".');
    }
  }
  return config;
}

/**
 * Preferred constraints: the requested device (or facing mode), resolution and
 * FPS. `ideal` values let the browser pick the closest match instead of failing.
 */
export function buildVideoConstraints(config: CameraConfig): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: config.resolution.width },
    height: { ideal: config.resolution.height },
    frameRate:
      config.maxFrameRate === undefined
        ? { ideal: config.frameRate }
        : { ideal: config.frameRate, max: config.maxFrameRate },
  };
  if (config.deviceId !== undefined) {
    video.deviceId = { exact: config.deviceId };
  } else {
    video.facingMode = { ideal: config.facingMode };
  }
  return { audio: false, video };
}

/** Last-resort constraints used by the fallback: any camera, no audio. */
export function buildFallbackConstraints(): MediaStreamConstraints {
  return { audio: false, video: true };
}
