import { MouthAnalyzer } from "../analysis/MouthAnalyzer";
import type { FaceAnalysis, MouthAnalysis } from "../types/analysis.types";
import type { FaceDetectionResult } from "../types/face.types";
import type {
  DetectorInput,
  MovementEvent,
  SmileDetectorOptions,
  SmileDetectorResult,
  SmileEvent,
} from "../types/detector.types";
import {
  isFaceAnalysis,
  resolveTemporalOptions,
  ScalarMovementDetector,
  type MetricThresholds,
  type SignalSample,
} from "./MovementDetector";

type SmileMetric = "smile";

/**
 * Detects a smile: neutral → smiling and held for `minActiveFrames`.
 *
 * Uses the smoothed `smileScore` of the mouth analysis (blendshapes when
 * available, otherwise mouth width relative to the eyes). The face must go
 * back to neutral before the next event.
 */
export class SmileDetector extends ScalarMovementDetector<SmileMetric, SmileEvent> {
  private readonly smile: MetricThresholds;
  private readonly mouthAnalyzer: MouthAnalyzer;

  constructor(options: SmileDetectorOptions = {}) {
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
    this.smile = { enter: options.smileThreshold ?? 0.5, exit: options.neutralThreshold ?? 0.3, decreasing: false };
    if (this.smile.exit > this.smile.enter) {
      throw new RangeError("SmileDetector: neutralThreshold must not be above smileThreshold.");
    }
    this.mouthAnalyzer = new MouthAnalyzer(options.mouth);
  }

  /** Feeds one frame. Call once per frame, in order. */
  update(input: DetectorInput, timestamp?: number): SmileDetectorResult {
    return this.process(input, timestamp);
  }

  protected sample(input: FaceAnalysis | FaceDetectionResult): SignalSample<SmileMetric> | null {
    const mouth: MouthAnalysis | null = isFaceAnalysis(input) ? input.mouth : this.mouthAnalyzer.analyze(input);
    return mouth ? { metric: "smile", value: mouth.smileScore } : null;
  }

  protected thresholds(): MetricThresholds {
    return this.smile;
  }

  protected buildEvent(base: MovementEvent): SmileEvent {
    return { ...base, type: "smile" };
  }
}
