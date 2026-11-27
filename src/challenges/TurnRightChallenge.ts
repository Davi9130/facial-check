import { HeadPoseDetector } from "../detectors/HeadPoseDetector";
import type { HeadMovement, HeadPoseDetectorOptions } from "../types/detector.types";
import { HeadMovementChallenge } from "./DetectorChallenge";

const DIRECTIONS: readonly HeadMovement[] = ["turn-right"];

/** `turn-right`: completed when `HeadPoseDetector` confirms the subject turns their head to their own right. */
export class TurnRightChallenge extends HeadMovementChallenge {
  readonly type = "turn-right" as const;

  constructor(options: Omit<HeadPoseDetectorOptions, "movements"> = {}) {
    super(new HeadPoseDetector({ ...options, movements: DIRECTIONS }), DIRECTIONS);
  }
}
