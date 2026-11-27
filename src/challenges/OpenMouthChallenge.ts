import { MouthDetector } from "../detectors/MouthDetector";
import type { MouthDetectorOptions } from "../types/detector.types";
import { ScalarDetectorChallenge } from "./DetectorChallenge";

/** `open-mouth`: completed when `MouthDetector` confirms the mouth was opened and held. */
export class OpenMouthChallenge extends ScalarDetectorChallenge {
  readonly type = "open-mouth" as const;

  constructor(options: MouthDetectorOptions = {}) {
    super(new MouthDetector(options));
  }
}
