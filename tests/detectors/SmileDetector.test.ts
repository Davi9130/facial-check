import { describe, expect, it } from "vitest";
import { SmileDetector } from "../../src/detectors";
import { syntheticFace } from "../analysis/syntheticFace";
import { analysis, events, feed, FRAME_MS, repeat } from "./sequences";

const smile = (v: number, ts: number) => analysis(ts, { mouth: { smileScore: v } });
function run(detector: SmileDetector, values: number[]) {
  return feed(values, smile, (input, ts) => detector.update(input, ts));
}

describe("SmileDetector", () => {
  it("detects a held smile", () => {
    const results = run(new SmileDetector(), [...repeat(0, 4), ...repeat(0.9, 8)]);
    const found = events(results);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "smile" });
    expect(found[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("ignores a one-frame smile score spike", () => {
    expect(events(run(new SmileDetector(), [...repeat(0, 4), 1, ...repeat(0, 8)]))).toHaveLength(0);
    expect(events(run(new SmileDetector({ smoothing: 1 }), [...repeat(0, 4), 1, ...repeat(0, 8)]))).toHaveLength(0);
  });

  it("ignores a face that is already smiling", () => {
    expect(events(run(new SmileDetector(), repeat(0.9, 20)))).toHaveLength(0);
  });

  it("re-arms after returning to neutral", () => {
    const cycle = [...repeat(0.9, 8), ...repeat(0, 5)];
    expect(events(run(new SmileDetector(), [...repeat(0, 4), ...cycle, ...cycle]))).toHaveLength(2);
  });

  it("disarms when the mouth is not analyzable", () => {
    const detector = new SmileDetector();
    const results = feed(
      [...repeat(0, 4), ...repeat(0.9, 2), -1, ...repeat(0.9, 6)],
      (v, ts) => (v < 0 ? analysis(ts, { mouth: null }) : smile(v, ts)),
      (input, ts) => detector.update(input, ts),
    );
    expect(results[6]?.hasData).toBe(false);
    expect(events(results)).toHaveLength(0);
  });

  it("accepts raw engine results", () => {
    const detector = new SmileDetector();
    const smiles = [...repeat(0, 4), ...repeat(1, 8)];
    const results = smiles.map((s, i) => detector.update(syntheticFace({ smile: s }), i * FRAME_MS));
    expect(events(results)).toHaveLength(1);
  });

  it("validates options", () => {
    expect(() => new SmileDetector({ smileThreshold: 0.3, neutralThreshold: 0.5 })).toThrow(RangeError);
  });
});
