import { describe, expect, it } from "vitest";
import { EyeAnalyzer, computeEyeAspectRatio } from "../../src/analysis";
import { boxOnlyFace, syntheticFace } from "./syntheticFace";

describe("computeEyeAspectRatio", () => {
  it("computes (|p2-p6| + |p3-p5|) / (2·|p1-p4|)", () => {
    const eye = [
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: 3, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(computeEyeAspectRatio(eye)).toBeCloseTo(4 / 6);
  });

  it("returns null for incomplete or degenerate eyes", () => {
    expect(computeEyeAspectRatio([{ x: 0, y: 0 }])).toBeNull();
    expect(computeEyeAspectRatio(Array.from({ length: 6 }, () => ({ x: 1, y: 1 })))).toBeNull();
  });
});

describe("EyeAnalyzer", () => {
  const analyzer = new EyeAnalyzer();

  it("reports open eyes from landmarks", () => {
    const eyes = analyzer.analyze(syntheticFace({ eyeOpen: 0.5 }));
    expect(eyes?.source).toBe("landmarks");
    expect(eyes?.averageEar).toBeGreaterThan(0.3);
    expect(eyes?.bothClosed).toBe(false);
    expect(eyes?.openness).toBe(1);
  });

  it("reports closed eyes from landmarks", () => {
    const eyes = analyzer.analyze(syntheticFace({ eyeOpen: 0.05 }));
    expect(eyes?.averageEar).toBeLessThan(0.1);
    expect(eyes?.left.closed).toBe(true);
    expect(eyes?.right.closed).toBe(true);
    expect(eyes?.bothClosed).toBe(true);
  });

  it("tells the eyes apart (subject's own sides)", () => {
    const eyes = analyzer.analyze(syntheticFace({ leftEyeOpen: 0.05, rightEyeOpen: 0.5 }));
    expect(eyes?.left.closed).toBe(true);
    expect(eyes?.right.closed).toBe(false);
    expect(eyes?.bothClosed).toBe(false);
  });

  it("measures in pixels, so a non-square frame does not change EAR", () => {
    const square = analyzer.analyze(syntheticFace({ imageWidth: 480, imageHeight: 480 }));
    const wide = analyzer.analyze(syntheticFace({ imageWidth: 1280, imageHeight: 480 }));
    expect(wide?.averageEar).toBeCloseTo(square?.averageEar ?? NaN, 6);
  });

  it("prefers blink blendshapes and still reports EAR", () => {
    const eyes = analyzer.analyze(
      syntheticFace({ eyeOpen: 0.5, blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 } }),
    );
    expect(eyes?.source).toBe("blendshapes");
    expect(eyes?.bothClosed).toBe(true);
    expect(eyes?.left.openness).toBeCloseTo(0.1);
    expect(eyes?.averageEar).toBeGreaterThan(0.3);
  });

  it("falls back to landmarks when blendshapes lack the blink keys", () => {
    const eyes = analyzer.analyze(syntheticFace({ eyeOpen: 0.05, blendshapes: { jawOpen: 0.1 } }));
    expect(eyes?.source).toBe("landmarks");
    expect(eyes?.bothClosed).toBe(true);
  });

  it("can be told to prefer landmarks", () => {
    const eyes = new EyeAnalyzer({ preferBlendshapes: false }).analyze(
      syntheticFace({ eyeOpen: 0.5, blendshapes: { eyeBlinkLeft: 1, eyeBlinkRight: 1 } }),
    );
    expect(eyes?.source).toBe("landmarks");
    expect(eyes?.bothClosed).toBe(false);
  });

  it("uses blendshapes without landmarks", () => {
    const eyes = analyzer.analyze({ ...boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }), blendshapes: { eyeBlinkLeft: 0, eyeBlinkRight: 0 } });
    expect(eyes?.source).toBe("blendshapes");
    expect(eyes?.averageEar).toBeNull();
    expect(eyes?.openness).toBe(1);
  });

  it("returns null without landmarks or blendshapes", () => {
    expect(analyzer.analyze(boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }))).toBeNull();
  });

  it("honors a custom EAR threshold", () => {
    const strict = new EyeAnalyzer({ closedEarThreshold: 0.4 });
    expect(strict.analyze(syntheticFace({ eyeOpen: 0.5 }))?.bothClosed).toBe(true);
  });
});
