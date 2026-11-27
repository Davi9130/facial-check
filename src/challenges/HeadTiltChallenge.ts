import { HeadPoseDetector } from "../detectors/HeadPoseDetector";
import type { HeadMovement, HeadPoseDetectorOptions } from "../types/detector.types";
import { HeadMovementChallenge } from "./DetectorChallenge";

const DIRECTIONS: readonly HeadMovement[] = ["tilt-left", "tilt-right"];

/** `head-tilt`: completed when `HeadPoseDetector` confirms the head is tilted to either side. */
export class HeadTiltChallenge extends HeadMovementChallenge {
  readonly type = "head-tilt" as const;

  constructor(options: Omit<HeadPoseDetectorOptions, "movements"> = {}) {
    super(new HeadPoseDetector({ ...options, movements: DIRECTIONS }), DIRECTIONS);
  }
}
