import { describe, expect, it } from "vitest";
import { FaceAnalyzer } from "../../src/analysis/FaceAnalyzer";
import { ChallengeManager } from "../../src/challenges/ChallengeManager";
import { BlinkDetector } from "../../src/detectors/BlinkDetector";
import { HeadPoseDetector } from "../../src/detectors/HeadPoseDetector";
import { MouthDetector } from "../../src/detectors/MouthDetector";
import { SmileDetector } from "../../src/detectors/SmileDetector";
import type { ChallengeType } from "../../src/types/challenge.types";
import { syntheticFace, type SyntheticFaceOptions } from "../analysis/syntheticFace";
import { FRAME_MS } from "../detectors/sequences";

/**
 * End-to-end pipeline on synthetic 68-point landmarks: geometry → FaceAnalyzer
 * → detectors / ChallengeManager. Unlike the unit tests (which feed
 * hand-made `FaceAnalysis` values), every metric here is computed from points.
 */

type Shot = SyntheticFaceOptions | null;
const rep = (shot: Shot, n: number): Shot[] => Array.from({ length: n }, () => shot);
const NEUTRAL: SyntheticFaceOptions = {};

/** Interpolates a numeric option from `from` to `to` over `n` frames. */
function ramp(key: "yaw" | "roll" | "pitch" | "mouthGap" | "smile" | "eyeOpen", from: number, to: number, n: number): Shot[] {
  return Array.from({ length: n }, (_, i) => ({ [key]: from + ((to - from) * (i + 1)) / n }));
}

const PERFORM: Record<ChallengeType, Shot[]> = {
  blink: [...rep(NEUTRAL, 8), ...ramp("eyeOpen", 0.5, 0.05, 2), ...rep({ eyeOpen: 0.05 }, 2), ...ramp("eyeOpen", 0.05, 0.5, 2), ...rep(NEUTRAL, 8)],
  "open-mouth": [...rep(NEUTRAL, 8), ...ramp("mouthGap", 0, 2.5, 3), ...rep({ mouthGap: 2.5 }, 12), ...ramp("mouthGap", 2.5, 0, 3), ...rep(NEUTRAL, 6)],
  smile: [...rep(NEUTRAL, 8), ...ramp("smile", 0, 1, 3), ...rep({ smile: 1 }, 12), ...ramp("smile", 1, 0, 3), ...rep(NEUTRAL, 6)],
  "turn-left": [...rep(NEUTRAL, 8), ...ramp("yaw", 0, -35, 5), ...rep({ yaw: -35 }, 12), ...ramp("yaw", -35, 0, 5), ...rep(NEUTRAL, 8)],
  "turn-right": [...rep(NEUTRAL, 8), ...ramp("yaw", 0, 35, 5), ...rep({ yaw: 35 }, 12), ...ramp("yaw", 35, 0, 5), ...rep(NEUTRAL, 8)],
  "head-tilt": [...rep(NEUTRAL, 8), ...ramp("roll", 0, 30, 5), ...rep({ roll: 30 }, 12), ...ramp("roll", 30, 0, 5), ...rep(NEUTRAL, 8)],
};

function run<R>(shots: readonly Shot[], step: (analysis: ReturnType<FaceAnalyzer["analyze"]>, ts: number) => R, start = 0) {
  const analyzer = new FaceAnalyzer();
  const out: R[] = [];
  let ts = start;
  for (const shot of shots) {
    out.push(step(analyzer.analyze(shot ? syntheticFace(shot) : null, ts), ts));
    ts += FRAME_MS;
  }
  return { out, end: ts };
}

describe("pipeline — detectors on synthetic landmarks", () => {
  it("BlinkDetector fires exactly once for one blink", () => {
    const d = new BlinkDetector();
    const { out } = run(PERFORM.blink, (a, ts) => d.update(a, ts));
    expect(out.filter((r) => r.event)).toHaveLength(1);
  });

  it("MouthDetector fires for an opened mouth", () => {
    const d = new MouthDetector();
    const { out } = run(PERFORM["open-mouth"], (a, ts) => d.update(a, ts));
    expect(out.filter((r) => r.event)).toHaveLength(1);
  });

  it("SmileDetector fires for a smile", () => {
    const d = new SmileDetector();
    const { out } = run(PERFORM.smile, (a, ts) => d.update(a, ts));
    expect(out.filter((r) => r.event)).toHaveLength(1);
  });

  it.each([
    ["turn-left", "turn-left"],
    ["turn-right", "turn-right"],
    ["head-tilt", "tilt-right"],
  ] as const)("HeadPoseDetector reports %s as %s", (challenge, direction) => {
    const d = new HeadPoseDetector();
    const { out } = run(PERFORM[challenge], (a, ts) => d.update(a, ts));
    expect(out.flatMap((r) => (r.event ? [r.event.direction] : []))).toEqual([direction]);
  });

  it("a still neutral face produces no movement", () => {
    const detectors = [new BlinkDetector(), new MouthDetector(), new SmileDetector(), new HeadPoseDetector()];
    const { out } = run(rep(NEUTRAL, 90), (a, ts) => detectors.map((d) => d.update(a, ts)));
    expect(out.flat().filter((r) => r.event)).toHaveLength(0);
  });
});

describe("pipeline — ChallengeManager on synthetic landmarks", () => {
  const ALL: ChallengeType[] = ["blink", "open-mouth", "smile", "turn-left", "turn-right", "head-tilt"];

  it.each(ALL)("validates %s from geometry alone", (type) => {
    const manager = new ChallengeManager({ challenges: [type], randomChallenges: false, now: () => 0 });
    manager.start({ timestamp: 0 });
    run(PERFORM[type], (a, ts) => manager.update(a, ts));
    expect(manager.getStatus()).toBe("passed");
  });

  it("runs a full random sequence end to end", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const manager = new ChallengeManager({ challenges: ALL, randomChallenges: true, random, now: () => 0 });
    manager.start({ timestamp: 0 });
    const order = manager.getChallenges().map((c) => c.type);
    run(order.flatMap((t) => PERFORM[t]), (a, ts) => manager.update(a, ts));
    expect(manager.getResult().passed).toBe(true);
  });

  it("does not pass a static photo (no movement) and times out", () => {
    const manager = new ChallengeManager({ challenges: ["blink"], randomChallenges: false, timeoutMs: 3_000, maxAttempts: 1, now: () => 0 });
    manager.start({ timestamp: 0 });
    run(rep(NEUTRAL, 150), (a, ts) => manager.update(a, ts));
    expect(manager.getStatus()).toBe("failed");
    expect(manager.getResult().passed).toBe(false);
  });

  it("does not validate the wrong movement", () => {
    const manager = new ChallengeManager({ challenges: ["turn-left"], randomChallenges: false, timeoutMs: 60_000, now: () => 0 });
    manager.start({ timestamp: 0 });
    run([...PERFORM["turn-right"], ...PERFORM.blink, ...PERFORM.smile], (a, ts) => manager.update(a, ts));
    expect(manager.getStatus()).toBe("running");
  });
});
