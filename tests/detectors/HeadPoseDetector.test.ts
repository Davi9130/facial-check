import { describe, expect, it } from "vitest";
import { HeadPoseDetector, HEAD_MOVEMENTS } from "../../src/detectors";
import type { HeadPoseDetectorResult } from "../../src/detectors";
import { syntheticFace } from "../analysis/syntheticFace";
import { analysis, feed, FRAME_MS, repeat } from "./sequences";

type Axis = "yaw" | "pitch" | "roll";

function run(detector: HeadPoseDetector, axis: Axis, values: number[]) {
  return feed(values, (v, ts) => analysis(ts, { headPose: { [axis]: v } }), (input, ts) => detector.update(input, ts));
}
const directions = (results: HeadPoseDetectorResult[]) => results.flatMap((r) => r.events.map((e) => e.direction));

describe("HeadPoseDetector", () => {
  it.each([
    ["turn-right", "yaw", 30],
    ["turn-left", "yaw", -30],
    ["look-up", "pitch", 25],
    ["look-down", "pitch", -25],
    ["tilt-right", "roll", 25],
    ["tilt-left", "roll", -25],
  ] as const)("detects %s", (direction, axis, angle) => {
    const results = run(new HeadPoseDetector(), axis, [...repeat(0, 4), ...repeat(angle, 10)]);
    expect(directions(results)).toEqual([direction]);
    const event = results.find((r) => r.event)?.event;
    expect(event).toMatchObject({ type: "head-movement", direction });
    expect(Math.abs(event?.peak ?? 0)).toBeGreaterThan(15);
  });

  it("ignores a one-frame pose glitch", () => {
    expect(directions(run(new HeadPoseDetector(), "yaw", [...repeat(0, 4), 45, ...repeat(0, 8)]))).toEqual([]);
    expect(directions(run(new HeadPoseDetector({ smoothing: 1 }), "yaw", [...repeat(0, 4), 45, ...repeat(0, 8)]))).toEqual([]);
  });

  it("needs a frontal start on the axis", () => {
    expect(directions(run(new HeadPoseDetector(), "yaw", repeat(30, 20)))).toEqual([]);
  });

  it("does not count the same turn twice without returning to frontal", () => {
    const values = [...repeat(0, 4), ...repeat(30, 10), ...repeat(15, 6), ...repeat(30, 10)];
    expect(directions(run(new HeadPoseDetector(), "yaw", values))).toEqual(["turn-right"]);
  });

  it("detects a left turn followed by a right turn", () => {
    const values = [...repeat(0, 4), ...repeat(-30, 10), ...repeat(0, 6), ...repeat(30, 10)];
    const detector = new HeadPoseDetector();
    const results = run(detector, "yaw", values);
    expect(directions(results)).toEqual(["turn-left", "turn-right"]);
    expect(detector.counts).toEqual({ "turn-left": 1, "turn-right": 1 });
    expect(results.at(-1)?.count).toBe(2);
  });

  it("only reports the enabled movements", () => {
    const detector = new HeadPoseDetector({ movements: ["turn-left"] });
    const results = run(detector, "yaw", [...repeat(0, 4), ...repeat(30, 10)]);
    expect(directions(results)).toEqual([]);
    expect(Object.keys(results.at(-1)?.phases ?? {})).toEqual(["turn-left"]);
  });

  it("supports custom thresholds", () => {
    const detector = new HeadPoseDetector({ yaw: { enter: 40, exit: 20 } });
    expect(directions(run(detector, "yaw", [...repeat(0, 4), ...repeat(30, 10)]))).toEqual([]);
  });

  it("reports progress and the active movement while turning", () => {
    const results = run(new HeadPoseDetector(), "yaw", [...repeat(0, 4), ...repeat(-30, 2)]);
    expect(results.at(-1)).toMatchObject({ activeMovement: "turn-left" });
    expect(results.at(-1)?.progress).toBeGreaterThan(0);
    expect(results.at(-1)?.progress).toBeLessThan(1);
  });

  it("disarms without pose data", () => {
    const detector = new HeadPoseDetector();
    const results = feed(
      [...repeat(0, 4), ...repeat(30, 2), -1, ...repeat(30, 8)],
      (v, ts) => (v < 0 ? null : analysis(ts, { headPose: { yaw: v } })),
      (input, ts) => detector.update(input, ts),
    );
    expect(results[6]).toMatchObject({ hasData: false, pose: null });
    expect(directions(results)).toEqual([]);
  });

  it("accepts raw engine results (landmark pose estimate)", () => {
    const detector = new HeadPoseDetector();
    const yaws = [...repeat(0, 4), ...repeat(-35, 10)];
    const results = yaws.map((yaw, i) => detector.update(syntheticFace({ yaw }), i * FRAME_MS));
    expect(directions(results)).toEqual(["turn-left"]);
  });

  it("validates options", () => {
    expect(HEAD_MOVEMENTS).toHaveLength(6);
    expect(() => new HeadPoseDetector({ yaw: { enter: 10, exit: 20 } })).toThrow(RangeError);
    // @ts-expect-error unknown movement
    expect(() => new HeadPoseDetector({ movements: ["spin"] })).toThrow(RangeError);
  });
});
