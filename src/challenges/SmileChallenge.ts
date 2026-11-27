import { SmileDetector } from "../detectors/SmileDetector";
import type { SmileDetectorOptions } from "../types/detector.types";
import { ScalarDetectorChallenge } from "./DetectorChallenge";

/** `smile`: completed when `SmileDetector` confirms a smile held from a neutral face. */
export class SmileChallenge extends ScalarDetectorChallenge {
  readonly type = "smile" as const;

  constructor(options: SmileDetectorOptions = {}) {
    super(new SmileDetector(options));
  }
}
