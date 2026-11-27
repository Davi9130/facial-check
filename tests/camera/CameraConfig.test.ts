import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_CONFIG,
  buildFallbackConstraints,
  buildVideoConstraints,
  resolveCameraConfig,
} from "../../src/camera/CameraConfig";

describe("resolveCameraConfig", () => {
  it("defaults to the front camera at 640x480 / 30 fps with fallback", () => {
    expect(resolveCameraConfig()).toEqual(DEFAULT_CAMERA_CONFIG);
    expect(DEFAULT_CAMERA_CONFIG.facingMode).toBe("user");
  });

  it("applies custom resolution and FPS", () => {
    const config = resolveCameraConfig({ resolution: { width: 1280, height: 720 }, frameRate: 24, maxFrameRate: 30 });
    expect(config.resolution).toEqual({ width: 1280, height: 720 });
    expect(config.frameRate).toBe(24);
    expect(config.maxFrameRate).toBe(30);
  });

  it.each([
    [{ frameRate: 0 }],
    [{ frameRate: Number.NaN }],
    [{ resolution: { width: -1, height: 480 } }],
    [{ frameRate: 30, maxFrameRate: 15 }],
  ])("rejects invalid options %j", (options) => {
    expect(() => resolveCameraConfig(options)).toThrow(RangeError);
  });
});

describe("buildVideoConstraints", () => {
  it("prefers the facing mode with ideal resolution and FPS, no audio", () => {
    expect(buildVideoConstraints(resolveCameraConfig())).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
    });
  });

  it("uses an exact deviceId instead of facingMode when given", () => {
    const video = buildVideoConstraints(resolveCameraConfig({ deviceId: "cam-1", maxFrameRate: 60 }))
      .video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: "cam-1" });
    expect(video.facingMode).toBeUndefined();
    expect(video.frameRate).toEqual({ ideal: 30, max: 60 });
  });

  it("fallback asks for any camera", () => {
    expect(buildFallbackConstraints()).toEqual({ audio: false, video: true });
  });
});
