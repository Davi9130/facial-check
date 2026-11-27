import { describe, expect, it } from "vitest";
import {
  BlinkChallenge,
  CHALLENGE_FACTORIES,
  CHALLENGE_TYPES,
  CHALLENGES,
  HeadTiltChallenge,
  isChallengeType,
  OpenMouthChallenge,
  SmileChallenge,
  TurnLeftChallenge,
  TurnRightChallenge,
} from "../../src/challenges";
import type { Challenge, ChallengeStep } from "../../src/types/challenge.types";
import { frame, PERFORM, rep, FRAME_MS, type Pose } from "./frames";

function run(challenge: Challenge, poses: readonly Pose[]): ChallengeStep[] {
  return poses.map((p, i) => challenge.update(frame(p, i * FRAME_MS), i * FRAME_MS));
}

describe("challenge catalog", () => {
  it("has the six initial challenges with their public ids", () => {
    expect(CHALLENGES).toEqual({
      BLINK: "blink",
      OPEN_MOUTH: "open-mouth",
      SMILE: "smile",
      TURN_LEFT: "turn-left",
      TURN_RIGHT: "turn-right",
      HEAD_TILT: "head-tilt",
    });
    expect(CHALLENGE_TYPES).toHaveLength(6);
    expect(isChallengeType("blink")).toBe(true);
    expect(isChallengeType("nod")).toBe(false);
  });

  it.each(CHALLENGE_TYPES.map((t) => [t]))("%s factory builds a challenge of that type", (type) => {
    expect(CHALLENGE_FACTORIES[type]({}).type).toBe(type);
  });
});

describe.each([
  ["blink", () => new BlinkChallenge()],
  ["open-mouth", () => new OpenMouthChallenge()],
  ["smile", () => new SmileChallenge()],
  ["turn-left", () => new TurnLeftChallenge()],
  ["turn-right", () => new TurnRightChallenge()],
  ["head-tilt", () => new HeadTiltChallenge()],
] as const)("%s challenge", (type, create) => {
  it("completes once when the movement is performed, with evidence", () => {
    const steps = run(create(), PERFORM[type]);
    const done = steps.filter((s) => s.completed);
    expect(done).toHaveLength(1);
    expect(done[0]?.progress).toBe(1);
    expect(done[0]?.evidence?.confidence).toBeGreaterThan(0);
    expect(done[0]?.evidence).not.toHaveProperty("peak");
  });

  it("does not complete on a neutral face", () => {
    expect(run(create(), rep("neutral", 60)).some((s) => s.completed)).toBe(false);
  });

  it("does not complete on the other challenges' movements", () => {
    for (const other of CHALLENGE_TYPES) {
      if (other === type) continue;
      expect(run(create(), PERFORM[other]).some((s) => s.completed), `${type} on ${other}`).toBe(false);
    }
  });

  it("reports no face for missing frames", () => {
    expect(create().update(null, 0).hasFace).toBe(false);
  });
});

describe("head-tilt", () => {
  it("accepts a tilt to either side", () => {
    const left = run(new HeadTiltChallenge(), [...rep("neutral", 5), ...rep("roll-left", 10)]);
    expect(left.find((s) => s.completed)?.evidence?.direction).toBe("tilt-left");
  });
});

describe("detector parameters", () => {
  it("are passed to the detector", () => {
    // With a stricter yaw threshold, a 35° turn is no longer enough.
    const strict = new TurnLeftChallenge({ yaw: { enter: 50, exit: 10 } });
    expect(run(strict, PERFORM["turn-left"]).some((s) => s.completed)).toBe(false);
  });
});
