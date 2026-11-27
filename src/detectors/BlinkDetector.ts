import { EyeAnalyzer } from "../analysis/EyeAnalyzer";
import type { EyeAnalysis, FaceAnalysis } from "../types/analysis.types";
import type { FaceDetectionResult } from "../types/face.types";
import type {
  BlinkDetectorOptions,
  BlinkDetectorResult,
  BlinkEvent,
  BlinkMetric,
  DetectorInput,
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
 * Detects blinks: eyes open → closed → open again within `maxClosedMs`.
 *
 * Uses the smoothed Eye Aspect Ratio (mean of both eyes) when the eyes were
 * analyzed from landmarks, or the eye openness when they came from blink
 * blendshapes. Closing needs at least `minActiveFrames` frames below the
 * closed threshold and the reopening `minRestFrames` frames above the open
 * threshold, so a single noisy frame never counts.
 *
 * ```ts
 * const blink = new BlinkDetector();
 * const { event } = blink.update(analyzer.analyze(faces, now));
 * if (event) console.info("blink", event.confidence);
 * ```
 */
export class BlinkDetector extends ScalarMovementDetector<BlinkMetric, BlinkEvent> {
  private readonly ear: MetricThresholds;
  private readonly openness: MetricThresholds;
  private readonly eyeAnalyzer: EyeAnalyzer;

  constructor(options: BlinkDetectorOptions = {}) {
    super(
      "cycle",
      resolveTemporalOptions(options, {
        smoothing: 0.6,
        minActiveFrames: 2,
        minRestFrames: 2,
        minConfidence: 0.3,
        maxFrameGapMs: 500,
      }),
      options.maxClosedMs ?? 700,
    );
    this.ear = { enter: options.closedEar ?? 0.2, exit: options.openEar ?? 0.25, decreasing: true };
    this.openness = { enter: options.closedOpenness ?? 0.4, exit: options.openOpenness ?? 0.6, decreasing: true };
    if (this.ear.exit < this.ear.enter || this.openness.exit < this.openness.enter) {
      throw new RangeError("BlinkDetector: open thresholds must not be below closed thresholds.");
    }
    this.eyeAnalyzer = new EyeAnalyzer(options.eyes);
  }

  /** Feeds one frame. Call once per frame, in order. */
  update(input: DetectorInput, timestamp?: number): BlinkDetectorResult {
    return this.process(input, timestamp);
  }

  protected sample(input: FaceAnalysis | FaceDetectionResult): SignalSample<BlinkMetric> | null {
    const eyes: EyeAnalysis | null = isFaceAnalysis(input) ? input.eyes : this.eyeAnalyzer.analyze(input);
    if (!eyes) return null;
    if (eyes.source === "landmarks" && eyes.averageEar !== null) return { metric: "ear", value: eyes.averageEar };
    return { metric: "openness", value: eyes.openness };
  }

  protected thresholds(metric: BlinkMetric): MetricThresholds {
    return metric === "ear" ? this.ear : this.openness;
  }

  protected buildEvent(base: MovementEvent, metric: BlinkMetric): BlinkEvent {
    return { ...base, type: "blink", metric };
  }
}
