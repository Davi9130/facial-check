import { describe, expect, it } from "vitest";
import { HeadPoseAnalyzer, estimateHeadPoseFromLandmarks } from "../../src/analysis";
import type { FaceDetectionResult } from "../../src/types";
import { boxOnlyFace, syntheticFace } from "./syntheticFace";

describe("estimateHeadPoseFromLandmarks", () => {
  it("is close to zero for a frontal face", () => {
    const pose = estimateHeadPoseFromLandmarks(syntheticFace());
    expect(pose?.yaw).toBeCloseTo(0, 3);
    expect(pose?.pitch).toBeCloseTo(0, 3);
    expect(pose?.roll).toBeCloseTo(0, 3);
  });

  it.each([
    [{ yaw: 25 }, "yaw", 25],
    [{ yaw: -25 }, "yaw", -25],
    [{ pitch: 15 }, "pitch", 15],
    [{ pitch: -15 }, "pitch", -15],
    [{ roll: 20 }, "roll", 20],
    [{ roll: -20 }, "roll", -20],
  ] as const)("recovers %j", (rotation, axis, expected) => {
    const pose = estimateHeadPoseFromLandmarks(syntheticFace(rotation));
    expect(pose?.[axis]).toBeCloseTo(expected, 0);
  });

  it("keeps the axes apart when the head is rolled", () => {
    const pose = estimateHeadPoseFromLandmarks(syntheticFace({ yaw: 20, pitch: 10, roll: 15 }));
    expect(pose?.yaw).toBeGreaterThan(15);
    expect(pose?.yaw).toBeLessThan(25);
    expect(pose?.pitch).toBeGreaterThan(6);
    expect(pose?.pitch).toBeLessThan(14);
    expect(pose?.roll).toBeCloseTo(15, 0);
  });

  it("is not distorted by a non-square frame", () => {
    const pose = estimateHeadPoseFromLandmarks(syntheticFace({ yaw: 20, imageWidth: 1280, imageHeight: 480 }));
    expect(pose?.yaw).toBeCloseTo(20, 0);
    expect(pose?.roll).toBeCloseTo(0, 3);
  });

  it("returns null without complete landmarks", () => {
    expect(estimateHeadPoseFromLandmarks(boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }))).toBeNull();
    const face = syntheticFace();
    const regions = face.landmarks?.regions;
    if (!regions) throw new Error("synthetic face has landmarks");
    const broken: FaceDetectionResult = { ...face, landmarks: { points: [], regions: { ...regions, jawline: [] } } };
    expect(estimateHeadPoseFromLandmarks(broken)).toBeNull();
  });
});

describe("HeadPoseAnalyzer", () => {
  it("prefers the engine pose", () => {
    const analysis = new HeadPoseAnalyzer().analyze(syntheticFace({ yaw: 30, pose: { yaw: 1, pitch: 2, roll: 3 } }));
    expect(analysis).toMatchObject({ yaw: 1, pitch: 2, roll: 3, source: "engine", frontal: true });
  });

  it("estimates from landmarks when the engine gives no pose", () => {
    const analysis = new HeadPoseAnalyzer().analyze(syntheticFace({ yaw: 30 }));
    expect(analysis?.source).toBe("landmarks");
    expect(analysis?.frontal).toBe(false);
    expect(analysis?.yaw).toBeCloseTo(30, 0);
  });

  it("can ignore the engine pose", () => {
    const analysis = new HeadPoseAnalyzer({ preferEnginePose: false }).analyze(
      syntheticFace({ pose: { yaw: 40, pitch: 0, roll: 0 } }),
    );
    expect(analysis?.source).toBe("landmarks");
    expect(analysis?.frontal).toBe(true);
  });

  it("falls back to the engine pose when landmarks are missing", () => {
    const analysis = new HeadPoseAnalyzer({ preferEnginePose: false }).analyze({
      ...boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }),
      pose: { yaw: 5, pitch: 0, roll: 0 },
    });
    expect(analysis?.source).toBe("engine");
  });

  it("applies the frontal limits", () => {
    const analyzer = new HeadPoseAnalyzer({ maxFrontalYaw: 10 });
    expect(analyzer.analyze(syntheticFace({ yaw: 12 }))?.frontal).toBe(false);
    expect(analyzer.analyze(syntheticFace({ yaw: 8 }))?.frontal).toBe(true);
  });

  it("returns null without pose or landmarks", () => {
    expect(new HeadPoseAnalyzer().analyze(boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }))).toBeNull();
  });
});
