import { MouthAnalyzer } from "../analysis/MouthAnalyzer";
import type { FaceAnalysis, MouthAnalysis } from "../types/analysis.types";
import type { FaceDetectionResult } from "../types/face.types";
import type {
  DetectorInput,
  MouthDetectorOptions,
  MouthDetectorResult,
  MouthMetric,
  MouthOpenEvent,
  MovementEvent,
} from "../types/detector.types";
import {
  isFaceAnalysis,
  resolveTemporalOptions,
  ScalarMovementDetector,
  type MetricThresholds,
  type SignalSample,
} from "./MovementDetector";

/**
 * Detects the mouth opening: closed → open and held for `minActiveFrames`.
 *
 * Uses the smoothed Mouth Aspect Ratio when the mouth was analyzed from
 * landmarks, or the `jawOpen` openness when it came from blendshapes. After an
 * event the mouth must close again (below the closed threshold for
 * `minRestFrames`) before the next one.
 */
export class MouthDetector extends ScalarMovementDetector<MouthMetric, MouthOpenEvent> {
  private readonly mar: MetricThresholds;
  private readonly openness: MetricThresholds;
  private readonly mouthAnalyzer: MouthAnalyzer;

  constructor(options: MouthDetectorOptions = {}) {
    super(
      "hold",
      resolveTemporalOptions(options, {
        smoothing: 0.5,
        minActiveFrames: 4,
        minRestFrames: 3,
        minConfidence: 0.3,
        maxFrameGapMs: 500,
      }),
    );
    this.mar = { enter: options.openMar ?? 0.35, exit: options.closedMar ?? 0.25, decreasing: false };
    this.openness = { enter: options.openOpenness ?? 0.4, exit: options.closedOpenness ?? 0.25, decreasing: false };
    if (this.mar.exit > this.mar.enter || this.openness.exit > this.openness.enter) {
      throw new RangeError("MouthDetector: closed thresholds must not be above open thresholds.");
    }
    this.mouthAnalyzer = new MouthAnalyzer(options.mouth);
  }

  /** Feeds one frame. Call once per frame, in order. */
  update(input: DetectorInput, timestamp?: number): MouthDetectorResult {
    return this.process(input, timestamp);
  }

  protected sample(input: FaceAnalysis | FaceDetectionResult): SignalSample<MouthMetric> | null {
    const mouth: MouthAnalysis | null = isFaceAnalysis(input) ? input.mouth : this.mouthAnalyzer.analyze(input);
    if (!mouth) return null;
    if (mouth.openSource === "landmarks" && mouth.mar !== null) return { metric: "mar", value: mouth.mar };
    return { metric: "openness", value: mouth.openness };
  }

  protected thresholds(metric: MouthMetric): MetricThresholds {
    return metric === "mar" ? this.mar : this.openness;
  }

  protected buildEvent(base: MovementEvent, metric: MouthMetric): MouthOpenEvent {
    return { ...base, type: "open-mouth", metric };
  }
}
