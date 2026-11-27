import { describe, expect, it } from "vitest";
import { FaceAnalyzer } from "../../src/analysis";
import { boxOnlyFace, syntheticFace } from "./syntheticFace";

/** Feeds the same face for `n` frames, 33 ms apart, and returns the last analysis. */
function settle(analyzer: FaceAnalyzer, face = syntheticFace(), n = 10, start = 0) {
  let last = analyzer.analyze(face, start);
  for (let i = 1; i < n; i++) last = analyzer.analyze(face, start + i * 33);
  return last;
}

describe("FaceAnalyzer presence", () => {
  it.each([[null], [undefined], [[]]])("reports no face for %j", (input) => {
    const analysis = new FaceAnalyzer().analyze(input, 5);
    expect(analysis).toMatchObject({
      timestamp: 5,
      faceDetected: false,
      faceCount: 0,
      score: null,
      position: null,
      eyes: null,
      issues: ["no-face"],
      ready: false,
    });
  });

  it("accepts a single result or an array", () => {
    const analyzer = new FaceAnalyzer();
    expect(analyzer.analyze(syntheticFace(), 0).faceDetected).toBe(true);
    expect(analyzer.analyze([syntheticFace()], 33).faceDetected).toBe(true);
  });

  it("analyzes the highest-scoring face and flags multiple faces", () => {
    const analysis = new FaceAnalyzer().analyze([
      syntheticFace({ score: 0.6, centerX: 0.2 }),
      syntheticFace({ score: 0.9 }),
    ]);
    expect(analysis.faceCount).toBe(2);
    expect(analysis.score).toBe(0.9);
    expect(analysis.position?.centerX).toBeCloseTo(0.5, 2);
    expect(analysis.issues).toContain("multiple-faces");
  });

  it("ignores faces below minScore", () => {
    const analyzer = new FaceAnalyzer({ minScore: 0.7 });
    expect(analyzer.analyze(syntheticFace({ score: 0.5 })).faceDetected).toBe(false);
    const analysis = analyzer.analyze([syntheticFace({ score: 0.5 }), syntheticFace({ score: 0.8 })]);
    expect(analysis.faceCount).toBe(1);
  });

  it("includes eye, mouth and pose analysis", () => {
    const analysis = new FaceAnalyzer().analyze(syntheticFace({ yaw: 20, mouthGap: 2.5, eyeOpen: 0.05 }));
    expect(analysis.eyes?.bothClosed).toBe(true);
    expect(analysis.mouth?.open).toBe(true);
    expect(analysis.headPose?.yaw).toBeCloseTo(20, 0);
  });

  it("leaves landmark-based parts null when the engine gives only a box", () => {
    const analysis = new FaceAnalyzer().analyze(boxOnlyFace({ x: 0.35, y: 0.3, width: 0.3, height: 0.4 }));
    expect(analysis.faceDetected).toBe(true);
    expect(analysis.eyes).toBeNull();
    expect(analysis.mouth).toBeNull();
    expect(analysis.headPose).toBeNull();
    expect(analysis.position?.centered).toBe(true);
  });
});

describe("FaceAnalyzer position and size", () => {
  it("measures the offset from the guide", () => {
    const analysis = new FaceAnalyzer().analyze(boxOnlyFace({ x: 0.5, y: 0.3, width: 0.3, height: 0.4 }));
    expect(analysis.position?.offsetX).toBeCloseTo(0.15);
    expect(analysis.position?.offsetY).toBeCloseTo(0);
    expect(analysis.position?.centered).toBe(false);
    expect(analysis.issues).toContain("not-centered");
  });

  it("uses a custom guide", () => {
    const analyzer = new FaceAnalyzer({ guide: { centerX: 0.65, centerY: 0.5, tolerance: 0.05 } });
    expect(analyzer.analyze(boxOnlyFace({ x: 0.5, y: 0.3, width: 0.3, height: 0.4 })).position?.centered).toBe(true);
  });

  it("flags a face cut off by the frame edge", () => {
    const analysis = new FaceAnalyzer().analyze(boxOnlyFace({ x: 0, y: 0.3, width: 0.3, height: 0.4 }));
    expect(analysis.position?.fullyVisible).toBe(false);
    expect(analysis.issues).toContain("partially-visible");
  });

  it.each([
    [0.15, "too-far"],
    [0.5, "ok"],
    [0.85, "too-close"],
  ] as const)("face height %d of the frame is %s", (height, status) => {
    const analysis = new FaceAnalyzer().analyze(
      boxOnlyFace({ x: 0.4, y: (1 - height) / 2, width: 0.2, height }),
    );
    expect(analysis.size).toEqual({ ratio: height, status });
    if (status !== "ok") expect(analysis.issues).toContain(status);
  });

  it("rejects minFaceSize above maxFaceSize", () => {
    expect(() => new FaceAnalyzer({ minFaceSize: 0.8, maxFaceSize: 0.5 })).toThrow(RangeError);
  });
});

describe("FaceAnalyzer stability", () => {
  it("is unstable until the window fills, then ready", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 5 } });
    const first = analyzer.analyze(syntheticFace(), 0);
    expect(first.stability).toMatchObject({ stable: false, frames: 1 });
    expect(first.issues).toEqual(["unstable"]);

    const last = settle(analyzer, syntheticFace(), 5, 33);
    expect(last.stability.stable).toBe(true);
    expect(last.stability.frames).toBe(5);
    expect(last.issues).toEqual([]);
    expect(last.ready).toBe(true);
  });

  it("keeps the window bounded", () => {
    const last = settle(new FaceAnalyzer({ stability: { windowSize: 4 } }), syntheticFace(), 20);
    expect(last.stability.frames).toBe(4);
  });

  it("tolerates small jitter", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 6 } });
    let last = analyzer.analyze(syntheticFace(), 0);
    for (let i = 1; i < 6; i++) last = analyzer.analyze(syntheticFace({ centerX: 0.5 + (i % 2) * 0.01 }), i * 33);
    expect(last.stability.stable).toBe(true);
  });

  it("is unstable while the face drifts", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 6 } });
    let last = analyzer.analyze(syntheticFace(), 0);
    for (let i = 1; i < 6; i++) last = analyzer.analyze(syntheticFace({ centerX: 0.5 + i * 0.02 }), i * 33);
    expect(last.stability.jumped).toBe(false);
    expect(last.stability.movement).toBeGreaterThan(0.025);
    expect(last.stability.stable).toBe(false);
  });

  it("is unstable while the face size changes", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 6 } });
    let last = analyzer.analyze(syntheticFace(), 0);
    for (let i = 1; i < 6; i++) last = analyzer.analyze(syntheticFace({ scale: 12 + i * 0.8 }), i * 33);
    expect(last.stability.sizeChange).toBeGreaterThan(0.08);
    expect(last.stability.stable).toBe(false);
  });

  it("restarts the window on a jump", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 5 } });
    settle(analyzer, syntheticFace(), 5);
    const jumped = analyzer.analyze(syntheticFace({ centerX: 0.62 }), 1000 / 6);
    expect(jumped.stability).toMatchObject({ jumped: true, frames: 1, stable: false });
  });

  it("restarts the window after a gap without frames", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 5, maxFrameGapMs: 500 } });
    settle(analyzer, syntheticFace(), 5);
    expect(analyzer.analyze(syntheticFace(), 5000).stability.frames).toBe(1);
  });

  it("restarts the window when the face is lost", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 5 } });
    settle(analyzer, syntheticFace(), 5);
    analyzer.analyze([], 200);
    expect(analyzer.analyze(syntheticFace(), 233).stability.frames).toBe(1);
  });

  it("reset() clears the window", () => {
    const analyzer = new FaceAnalyzer({ stability: { windowSize: 5 } });
    settle(analyzer, syntheticFace(), 5);
    analyzer.reset();
    expect(analyzer.analyze(syntheticFace(), 200).stability.frames).toBe(1);
  });
});

describe("FaceAnalyzer privacy", () => {
  it("keeps no landmarks or images in its result", () => {
    const analysis = new FaceAnalyzer().analyze(syntheticFace());
    const json = JSON.stringify(analysis);
    expect(json).not.toContain("\"points\"");
    expect(json).not.toContain("\"regions\"");
  });
});
