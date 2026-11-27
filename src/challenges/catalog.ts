import type { ChallengeFactory, ChallengeType } from "../types/challenge.types";
import { BlinkChallenge } from "./BlinkChallenge";
import { HeadTiltChallenge } from "./HeadTiltChallenge";
import { OpenMouthChallenge } from "./OpenMouthChallenge";
import { SmileChallenge } from "./SmileChallenge";
import { TurnLeftChallenge } from "./TurnLeftChallenge";
import { TurnRightChallenge } from "./TurnRightChallenge";

/** Challenge ids, by catalog name. */
export const CHALLENGES = {
  BLINK: "blink",
  OPEN_MOUTH: "open-mouth",
  SMILE: "smile",
  TURN_LEFT: "turn-left",
  TURN_RIGHT: "turn-right",
  HEAD_TILT: "head-tilt",
} as const satisfies Record<string, ChallengeType>;

/** Every challenge id, in catalog order. */
export const CHALLENGE_TYPES: readonly ChallengeType[] = Object.values(CHALLENGES);

/** Default factory of each challenge. */
export const CHALLENGE_FACTORIES: Readonly<Record<ChallengeType, ChallengeFactory>> = {
  blink: (d) => new BlinkChallenge(d.blink),
  "open-mouth": (d) => new OpenMouthChallenge(d.mouth),
  smile: (d) => new SmileChallenge(d.smile),
  "turn-left": (d) => new TurnLeftChallenge(d.headPose),
  "turn-right": (d) => new TurnRightChallenge(d.headPose),
  "head-tilt": (d) => new HeadTiltChallenge(d.headPose),
};

export function isChallengeType(value: unknown): value is ChallengeType {
  return typeof value === "string" && (CHALLENGE_TYPES as readonly string[]).includes(value);
}
