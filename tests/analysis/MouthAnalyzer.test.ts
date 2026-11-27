import { describe, expect, it } from "vitest";
import { MouthAnalyzer, computeMouthAspectRatio } from "../../src/analysis";
import { boxOnlyFace, syntheticFace } from "./syntheticFace";

describe("computeMouthAspectRatio", () => {
  it("uses the 8 inner-lip points", () => {
    const inner = [
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: 3, y: -1 },
      { x: 4, y: 0 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(computeMouthAspectRatio(inner)).toBeCloseTo(6 / 8);
  });

  it("returns null for unsupported point counts", () => {
    expect(computeMouthAspectRatio([{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("MouthAnalyzer", () => {
  const analyzer = new MouthAnalyzer();

  it("reports a closed, neutral mouth", () => {
    const mouth = analyzer.analyze(syntheticFace());
    expect(mouth?.mar).toBeCloseTo(0);
    expect(mouth?.open).toBe(false);
    expect(mouth?.smiling).toBe(false);
    expect(mouth?.openSource).toBe("landmarks");
    expect(mouth?.smileSource).toBe("landmarks");
  });

  it("reports an open mouth from MAR", () => {
    const mouth = analyzer.analyze(syntheticFace({ mouthGap: 2.5 }));
    expect(mouth?.mar).toBeGreaterThan(0.5);
    expect(mouth?.open).toBe(true);
    expect(mouth?.openness).toBeGreaterThan(0.7);
  });

  it("grows MAR with the lip gap", () => {
    const small = analyzer.analyze(syntheticFace({ mouthGap: 0.5 }))?.mar ?? NaN;
    const large = analyzer.analyze(syntheticFace({ mouthGap: 2 }))?.mar ?? NaN;
    expect(large).toBeGreaterThan(small);
  });

  it("detects a smile from the mouth width", () => {
    const mouth = analyzer.analyze(syntheticFace({ smile: 1 }));
    expect(mouth?.smiling).toBe(true);
    expect(mouth?.smileScore).toBeGreaterThan(0.8);
    expect(mouth?.open).toBe(false);
  });

  it("keeps the smile score independent of face scale", () => {
    const near = analyzer.analyze(syntheticFace({ smile: 0.6, scale: 18 }))?.smileScore ?? NaN;
    const far = analyzer.analyze(syntheticFace({ smile: 0.6, scale: 8 }))?.smileScore ?? NaN;
    expect(near).toBeCloseTo(far, 6);
  });

  it("prefers blendshapes when available", () => {
    const mouth = analyzer.analyze(
      syntheticFace({ blendshapes: { jawOpen: 0.8, mouthSmileLeft: 0.7, mouthSmileRight: 0.9 } }),
    );
    expect(mouth?.openSource).toBe("blendshapes");
    expect(mouth?.open).toBe(true);
    expect(mouth?.smileSource).toBe("blendshapes");
    expect(mouth?.smileScore).toBeCloseTo(0.8);
    expect(mouth?.mar).toBeCloseTo(0);
  });

  it("falls back per metric when a blendshape is missing", () => {
    const mouth = analyzer.analyze(syntheticFace({ smile: 1, blendshapes: { jawOpen: 0 } }));
    expect(mouth?.openSource).toBe("blendshapes");
    expect(mouth?.smileSource).toBe("landmarks");
    expect(mouth?.smiling).toBe(true);
  });

  it("works with blendshapes only", () => {
    const mouth = analyzer.analyze({
      ...boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }),
      blendshapes: { jawOpen: 0.1, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 },
    });
    expect(mouth?.mar).toBeNull();
    expect(mouth?.open).toBe(false);
    expect(mouth?.smiling).toBe(false);
  });

  it("returns null without landmarks or blendshapes", () => {
    expect(analyzer.analyze(boxOnlyFace({ x: 0.3, y: 0.3, width: 0.3, height: 0.4 }))).toBeNull();
  });
});
