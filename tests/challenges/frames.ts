import type { FaceAnalysis } from "../../src/types/analysis.types";
import type { ChallengeType } from "../../src/types/challenge.types";
import { analysis, FRAME_MS } from "../detectors/sequences";

export { FRAME_MS };

export type Pose = "neutral" | "eyes-closed" | "mouth-open" | "smile" | "yaw-left" | "yaw-right" | "roll-left" | "roll-right";

export function frame(pose: Pose, ts: number): FaceAnalysis {
  switch (pose) {
    case "neutral":
      return analysis(ts);
    case "eyes-closed":
      return analysis(ts, { eyes: { averageEar: 0.08 } });
    case "mouth-open":
      return analysis(ts, { mouth: { mar: 0.7, openness: 0.9 } });
    case "smile":
      return analysis(ts, { mouth: { smileScore: 0.95 } });
    case "yaw-left":
      return analysis(ts, { headPose: { yaw: -35 } });
    case "yaw-right":
      return analysis(ts, { headPose: { yaw: 35 } });
    case "roll-left":
      return analysis(ts, { headPose: { roll: -30 } });
    case "roll-right":
      return analysis(ts, { headPose: { roll: 30 } });
  }
}

/** Pose sequence that performs each challenge from a neutral face. */
export const PERFORM: Record<ChallengeType, Pose[]> = {
  blink: [...rep("neutral", 5), ...rep("eyes-closed", 3), ...rep("neutral", 5)],
  "open-mouth": [...rep("neutral", 5), ...rep("mouth-open", 10), ...rep("neutral", 4)],
  smile: [...rep("neutral", 5), ...rep("smile", 10), ...rep("neutral", 4)],
  "turn-left": [...rep("neutral", 5), ...rep("yaw-left", 10), ...rep("neutral", 6)],
  "turn-right": [...rep("neutral", 5), ...rep("yaw-right", 10), ...rep("neutral", 6)],
  "head-tilt": [...rep("neutral", 5), ...rep("roll-right", 10), ...rep("neutral", 6)],
};

export function rep<P extends Pose | null>(pose: P, n: number): P[] {
  return Array.from({ length: n }, () => pose);
}

/** Feeds poses one per frame starting at `start`; returns the timestamp after the last frame. */
export function play(update: (input: FaceAnalysis | null, ts: number) => unknown, poses: readonly (Pose | null)[], start = 0): number {
  let ts = start;
  for (const p of poses) {
    update(p ? frame(p, ts) : null, ts);
    ts += FRAME_MS;
  }
  return ts;
}

/** Deterministic RNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
