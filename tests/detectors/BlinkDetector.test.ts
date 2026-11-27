import { describe, expect, it } from "vitest";
import { BlinkDetector } from "../../src/detectors";
import { FaceAnalyzer } from "../../src/analysis";
import { syntheticFace } from "../analysis/syntheticFace";
import { analysis, events, feed, FRAME_MS, repeat } from "./sequences";

const OPEN = 0.3;
const CLOSED = 0.08;
const ear = (v: number, ts: number) => analysis(ts, { eyes: { averageEar: v } });

function run(detector: BlinkDetector, values: number[]) {
  return feed(values, ear, (input, ts) => detector.update(input, ts));
}

describe("BlinkDetector", () => {
  it("detects an open → closed → open blink using EAR", () => {
    const results = run(new BlinkDetector(), [...repeat(OPEN, 5), ...repeat(CLOSED, 3), ...repeat(OPEN, 5)]);
    const found = events(results);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "blink", metric: "ear" });
    expect(found[0]?.peak).toBeLessThan(0.2);
    expect(found[0]?.confidence).toBeGreaterThan(0.3);
    expect(found[0]?.confidence).toBeLessThanOrEqual(1);
    expect(found[0]?.frames).toBeGreaterThanOrEqual(2);
    expect(results.at(-1)?.count).toBe(1);
  });

  it("counts consecutive blinks", () => {
    const blink = [...repeat(CLOSED, 3), ...repeat(OPEN, 4)];
    const results = run(new BlinkDetector(), [...repeat(OPEN, 4), ...blink, ...blink, ...blink]);
    expect(events(results)).toHaveLength(3);
  });

  it.each([
    ["with smoothing", {}],
    ["without smoothing", { smoothing: 1 }],
  ])("ignores a single closed frame (%s)", (_name, options) => {
    const results = run(new BlinkDetector(options), [...repeat(OPEN, 5), CLOSED, ...repeat(OPEN, 6)]);
    expect(events(results)).toHaveLength(0);
  });

  it("never fires on a single frame even if minActiveFrames is set to 1", () => {
    const results = run(new BlinkDetector({ smoothing: 1, minActiveFrames: 1 }), [...repeat(OPEN, 5), CLOSED, ...repeat(OPEN, 6)]);
    expect(events(results)).toHaveLength(0);
  });

  it("does not count eyes closed for longer than maxClosedMs", () => {
    const results = run(new BlinkDetector(), [...repeat(OPEN, 5), ...repeat(CLOSED, 40), ...repeat(OPEN, 5)]);
    expect(events(results)).toHaveLength(0);
  });

  it("needs to see the eyes open first", () => {
    const results = run(new BlinkDetector(), [...repeat(CLOSED, 5), ...repeat(OPEN, 5)]);
    expect(events(results)).toHaveLength(0);
  });

  it("needs the reopening to be confirmed", () => {
    const results = run(new BlinkDetector(), [...repeat(OPEN, 5), ...repeat(CLOSED, 3), OPEN]);
    expect(events(results)).toHaveLength(0);
    expect(results.at(-1)?.phase).toBe("active");
  });

  it("disarms when the face is lost mid-blink", () => {
    const detector = new BlinkDetector();
    const values = [...repeat(OPEN, 5), ...repeat(CLOSED, 2), -1, CLOSED, ...repeat(OPEN, 5)];
    const results = feed(values, (v, ts) => (v < 0 ? null : ear(v, ts)), (input, ts) => detector.update(input, ts));
    expect(results[7]).toMatchObject({ hasData: false, phase: "idle", value: null });
    expect(events(results)).toHaveLength(0);
  });

  it("disarms after a long gap between frames", () => {
    const detector = new BlinkDetector();
    run(detector, repeat(OPEN, 5));
    const later = 10_000;
    const results = feed([...repeat(CLOSED, 3), ...repeat(OPEN, 3)], ear, (input, ts) => detector.update(input, ts), later);
    expect(events(results)).toHaveLength(0);
  });

  it("uses eye openness when the eyes come from blendshapes", () => {
    const detector = new BlinkDetector();
    const values = [...repeat(1, 5), ...repeat(0.05, 3), ...repeat(1, 4)];
    const results = feed(
      values,
      (v, ts) => analysis(ts, { eyes: { source: "blendshapes", openness: v, averageEar: null } }),
      (input, ts) => detector.update(input, ts),
    );
    expect(events(results)).toEqual([expect.objectContaining({ metric: "openness" })]);
  });

  it("discards events below minConfidence", () => {
    const results = run(new BlinkDetector({ minConfidence: 1 }), [...repeat(OPEN, 5), 0.19, 0.19, ...repeat(OPEN, 5)]);
    expect(events(results)).toHaveLength(0);
  });

  it("accepts raw engine results and FaceAnalysis timestamps", () => {
    const detector = new BlinkDetector();
    const analyzer = new FaceAnalyzer();
    const openings = [...repeat(0.5, 5), ...repeat(0.03, 3), ...repeat(0.5, 4)];
    const fromRaw = openings.map((o, i) => detector.update(syntheticFace({ eyeOpen: o }), i * FRAME_MS));
    expect(events(fromRaw)).toHaveLength(1);

    const fromAnalysis = new BlinkDetector();
    const results = openings.map((o, i) => fromAnalysis.update(analyzer.analyze(syntheticFace({ eyeOpen: o }), 1000 + i * FRAME_MS)));
    expect(events(results)).toHaveLength(1);
    expect(results[0]?.timestamp).toBe(1000);
  });

  it("reset clears the count", () => {
    const detector = new BlinkDetector();
    run(detector, [...repeat(OPEN, 5), ...repeat(CLOSED, 3), ...repeat(OPEN, 3)]);
    expect(detector.count).toBe(1);
    detector.reset();
    expect(detector.count).toBe(0);
  });

  it("validates options", () => {
    expect(() => new BlinkDetector({ closedEar: 0.3, openEar: 0.2 })).toThrow(RangeError);
    expect(() => new BlinkDetector({ smoothing: 0 })).toThrow(RangeError);
    expect(() => new BlinkDetector({ minConfidence: 2 })).toThrow(RangeError);
  });
});
