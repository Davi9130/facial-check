import { HeadPoseDetector } from "../detectors/HeadPoseDetector";
import type { HeadMovement, HeadPoseDetectorOptions } from "../types/detector.types";
import { HeadMovementChallenge } from "./DetectorChallenge";

const DIRECTIONS: readonly HeadMovement[] = ["turn-left"];

/** `turn-left`: completed when `HeadPoseDetector` confirms the subject turns their head to their own left. */
export class TurnLeftChallenge extends HeadMovementChallenge {
  readonly type = "turn-left" as const;

  constructor(options: Omit<HeadPoseDetectorOptions, "movements"> = {}) {
    super(new HeadPoseDetector({ ...options, movements: DIRECTIONS }), DIRECTIONS);
  }
}
