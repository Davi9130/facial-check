import { describe, expect, it } from "vitest";
import { MouthDetector } from "../../src/detectors";
import { syntheticFace } from "../analysis/syntheticFace";
import { analysis, events, feed, FRAME_MS, repeat } from "./sequences";

const mar = (v: number, ts: number) => analysis(ts, { mouth: { mar: v } });
function run(detector: MouthDetector, values: number[]) {
  return feed(values, mar, (input, ts) => detector.update(input, ts));
}

describe("MouthDetector", () => {
  it("detects a mouth opening held for several frames using MAR", () => {
    const results = run(new MouthDetector(), [...repeat(0.05, 4), ...repeat(0.6, 8), ...repeat(0.05, 4)]);
    const found = events(results);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "open-mouth", metric: "mar" });
    expect(found[0]?.peak).toBeGreaterThan(0.35);
    expect(found[0]?.frames).toBeGreaterThanOrEqual(4);
  });

  it("fires once per opening and re-arms after the mouth closes", () => {
    const cycle = [...repeat(0.6, 10), ...repeat(0.05, 5)];
    const results = run(new MouthDetector(), [...repeat(0.05, 4), ...cycle, ...cycle]);
    expect(events(results)).toHaveLength(2);
  });

  it.each([
    ["one frame", [0.9]],
    ["two frames", [0.9, 0.9]],
  ])("ignores a short spike (%s)", (_name, spike) => {
    const results = run(new MouthDetector(), [...repeat(0.05, 5), ...spike, ...repeat(0.05, 6)]);
    expect(events(results)).toHaveLength(0);
  });

  it("ignores a single frame even without smoothing", () => {
    const results = run(new MouthDetector({ smoothing: 1 }), [...repeat(0.05, 5), 0.9, ...repeat(0.05, 6)]);
    expect(events(results)).toHaveLength(0);
  });

  it("does not fire when the mouth starts open", () => {
    const results = run(new MouthDetector(), repeat(0.6, 20));
    expect(events(results)).toHaveLength(0);
    expect(results.at(-1)?.phase).toBe("idle");
  });

  it("stays in the hysteresis band without re-arming", () => {
    // 0.3 is between closedMar (0.25) and openMar (0.35): not closed enough to re-arm.
    const results = run(new MouthDetector(), [...repeat(0.05, 4), ...repeat(0.6, 8), ...repeat(0.3, 10), ...repeat(0.6, 8)]);
    expect(events(results)).toHaveLength(1);
  });

  it("uses jawOpen openness when the mouth comes from blendshapes", () => {
    const detector = new MouthDetector();
    const results = feed(
      [...repeat(0, 4), ...repeat(0.8, 8)],
      (v, ts) => analysis(ts, { mouth: { openSource: "blendshapes", openness: v } }),
      (input, ts) => detector.update(input, ts),
    );
    expect(events(results)).toEqual([expect.objectContaining({ metric: "openness" })]);
  });

  it("accepts raw engine results", () => {
    const detector = new MouthDetector();
    const gaps = [...repeat(0, 4), ...repeat(2.5, 8)];
    const results = gaps.map((g, i) => detector.update(syntheticFace({ mouthGap: g }), i * FRAME_MS));
    expect(events(results)).toHaveLength(1);
  });

  it("supports custom thresholds and frame counts", () => {
    const detector = new MouthDetector({ openMar: 0.8, closedMar: 0.5, minActiveFrames: 10 });
    expect(events(run(detector, [...repeat(0.05, 4), ...repeat(0.6, 20)]))).toHaveLength(0);
    detector.reset();
    const results = run(detector, [...repeat(0.05, 4), ...repeat(1, 9)]);
    expect(events(results)).toHaveLength(0);
    expect(results.at(-1)?.progress).toBeGreaterThan(0.5);
  });

  it("validates options", () => {
    expect(() => new MouthDetector({ openMar: 0.2, closedMar: 0.3 })).toThrow(RangeError);
  });
});
