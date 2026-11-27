import { describe, expect, it } from "vitest";
import pkgJson from "../package.json";

const pkg: {
  exports: Record<string, unknown>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
} = pkgJson;

describe("public entry points", () => {
  it.each([
    ["facial-check", () => import("../src/index")],
    ["facial-check/core", () => import("../src/core/index")],
    ["facial-check/react", () => import("../src/react/index")],
    ["facial-check/detectors", () => import("../src/detectors/index")],
  ])("%s loads", async (_name, load) => {
    await expect(load()).resolves.toBeTypeOf("object");
  });

  it("exposes only the public subpaths", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./core", "./detectors", "./package.json", "./react"]);
  });

  it("keeps React as a peer dependency only", () => {
    expect(pkg.peerDependencies).toHaveProperty("react");
    expect(pkg.peerDependencies).toHaveProperty("react-dom");
    expect(pkg.dependencies).not.toHaveProperty("react");
    expect(pkg.dependencies).not.toHaveProperty("react-dom");
  });

  it("pins face-api.js to 0.22.2", () => {
    expect(pkg.dependencies["face-api.js"]).toBe("0.22.2");
  });
});

describe("facial-check/core engine exports", () => {
  it("exposes FaceEngineError and FaceApiEngine", async () => {
    const core = await import("../src/core/index");
    expect(core.FaceApiEngine).toBeTypeOf("function");
    expect(core.FaceEngineError).toBeTypeOf("function");
    expect(core.FACE_API_MODEL_FILES.detector).toContain("tiny_face_detector_model-weights_manifest.json");
  });

  it("exposes MediaPipeEngine", async () => {
    const core = await import("../src/core/index");
    expect(core.MediaPipeEngine).toBeTypeOf("function");
    expect(core.MEDIAPIPE_MODEL_FILES.model).toContain("face_landmarker.task");
  });
});

describe("camera exports", () => {
  it.each([
    ["facial-check", () => import("../src/index")],
    ["facial-check/core", () => import("../src/core/index")],
  ])("%s exposes CameraManager and CameraError", async (_name, load) => {
    const mod = await load();
    expect(mod).toHaveProperty("CameraManager");
    expect(mod).toHaveProperty("CameraError");
  });
});

describe("analysis exports", () => {
  it.each([
    ["facial-check", () => import("../src/index")],
    ["facial-check/core", () => import("../src/core/index")],
  ])("%s exposes FaceAnalyzer and its analyzers", async (_name, load) => {
    const mod = await load();
    for (const name of ["FaceAnalyzer", "EyeAnalyzer", "MouthAnalyzer", "HeadPoseAnalyzer", "computeEyeAspectRatio", "computeMouthAspectRatio", "estimateHeadPoseFromLandmarks"]) {
      expect(mod).toHaveProperty(name);
    }
  });
});

describe("detector exports", () => {
  it("facial-check/detectors exposes the movement detectors", async () => {
    const mod = await import("../src/detectors/index");
    for (const name of ["BlinkDetector", "MouthDetector", "SmileDetector", "HeadPoseDetector", "HEAD_MOVEMENTS", "ExponentialMovingAverage"]) {
      expect(mod).toHaveProperty(name);
    }
  });
});
