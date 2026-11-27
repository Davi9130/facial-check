import { BlinkDetector } from "../detectors/BlinkDetector";
import type { BlinkDetectorOptions } from "../types/detector.types";
import { ScalarDetectorChallenge } from "./DetectorChallenge";

/** `blink`: completed when `BlinkDetector` confirms a blink (open → closed → open). */
export class BlinkChallenge extends ScalarDetectorChallenge {
  readonly type = "blink" as const;

  constructor(options: BlinkDetectorOptions = {}) {
    super(new BlinkDetector(options));
  }
}
