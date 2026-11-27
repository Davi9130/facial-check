import type { FaceAnalysis } from "../types/analysis.types";
import type { FaceDetectionResult } from "../types/face.types";
import type {
  DetectorInput,
  DetectorPhase,
  DetectorResult,
  MovementEvent,
  TemporalDetectorOptions,
} from "../types/detector.types";
import { ExponentialMovingAverage } from "./smoothing";
import { TemporalTrigger, type TriggerConfig, type TriggerFiring, type TriggerMode } from "./TemporalTrigger";

export interface ResolvedTemporalOptions {
  readonly smoothing: number;
  readonly minActiveFrames: number;
  readonly minRestFrames: number;
  readonly minConfidence: number;
  readonly maxFrameGapMs: number;
}

export function resolveTemporalOptions(
  options: TemporalDetectorOptions,
  defaults: ResolvedTemporalOptions,
): ResolvedTemporalOptions {
  const resolved: ResolvedTemporalOptions = {
    smoothing: options.smoothing ?? defaults.smoothing,
    minActiveFrames: Math.max(2, Math.floor(options.minActiveFrames ?? defaults.minActiveFrames)),
    minRestFrames: Math.max(1, Math.floor(options.minRestFrames ?? defaults.minRestFrames)),
    minConfidence: options.minConfidence ?? defaults.minConfidence,
    maxFrameGapMs: options.maxFrameGapMs ?? defaults.maxFrameGapMs,
  };
  if (!(resolved.smoothing > 0 && resolved.smoothing <= 1)) {
    throw new RangeError("Detector: smoothing must be in (0, 1].");
  }
  if (!(resolved.minConfidence >= 0 && resolved.minConfidence <= 1)) {
    throw new RangeError("Detector: minConfidence must be between 0 and 1.");
  }
  return resolved;
}

/** `true` for a `FaceAnalysis` (from `FaceAnalyzer`), `false` for a raw engine `FaceDetectionResult`. */
export function isFaceAnalysis(input: FaceAnalysis | FaceDetectionResult): input is FaceAnalysis {
  return "faceDetected" in input;
}

/** Frame time: explicit argument, else the analysis timestamp, else `Date.now()`. */
export function frameTimestamp(input: DetectorInput, timestamp: number | undefined): number {
  if (timestamp !== undefined) return timestamp;
  if (input && isFaceAnalysis(input)) return input.timestamp;
  return Date.now();
}

/** A signal sample in the detector's natural unit, plus the thresholds that apply to it. */
export interface SignalSample<TMetric extends string> {
  readonly metric: TMetric;
  readonly value: number;
}

export interface MetricThresholds {
  /** Natural-unit value where the movement becomes active. */
  readonly enter: number;
  /** Natural-unit value where the face is back at rest. */
  readonly exit: number;
  /** `true` when the movement makes the value go *down* (e.g. EAR during a blink). */
  readonly decreasing: boolean;
}

/**
 * Shared engine of the single-signal detectors (blink, mouth, smile): extract
 * one value per frame, smooth it, run it through a `TemporalTrigger`, and
 * build typed events. Missing data, a long gap between frames or a change of
 * metric disarms the detector, so continuity is always required.
 */
export abstract class ScalarMovementDetector<TMetric extends string, TEvent extends MovementEvent> {
  protected readonly temporal: ResolvedTemporalOptions;
  private readonly smoother: ExponentialMovingAverage;
  private trigger: TemporalTrigger | null = null;
  private metric: TMetric | null = null;
  private lastTimestamp: number | null = null;
  private eventCount = 0;

  protected constructor(
    private readonly mode: TriggerMode,
    temporal: ResolvedTemporalOptions,
    private readonly maxActiveMs = Infinity,
  ) {
    this.temporal = temporal;
    this.smoother = new ExponentialMovingAverage(temporal.smoothing);
  }

  /** Events confirmed since creation or the last `reset()`. */
  get count(): number {
    return this.eventCount;
  }

  /** Clears all state, including the event count. */
  reset(): void {
    this.disarm();
    this.lastTimestamp = null;
    this.eventCount = 0;
  }

  protected abstract sample(input: FaceAnalysis | FaceDetectionResult): SignalSample<TMetric> | null;
  protected abstract thresholds(metric: TMetric): MetricThresholds;
  protected abstract buildEvent(base: MovementEvent, metric: TMetric): TEvent;

  protected process(input: DetectorInput, timestamp?: number): DetectorResult<TEvent> & { readonly metric: TMetric | null } {
    const ts = frameTimestamp(input, timestamp);
    const gap = this.lastTimestamp === null ? 0 : ts - this.lastTimestamp;
    this.lastTimestamp = ts;
    if (gap > this.temporal.maxFrameGapMs || gap < 0) this.disarm();

    const sample = input ? this.sample(input) : null;
    if (!sample || !Number.isFinite(sample.value)) {
      this.disarm();
      return this.empty(ts);
    }

    if (sample.metric !== this.metric) {
      this.disarm();
      this.metric = sample.metric;
    }
    const th = this.thresholds(sample.metric);
    const trigger = (this.trigger ??= new TemporalTrigger(this.triggerConfig(th)));

    const value = this.smoother.push(sample.value);
    const sign = th.decreasing ? -1 : 1;
    const step = trigger.update(sign * value, ts);

    let event: TEvent | null = null;
    if (step.fired) {
      event = this.buildEvent(toMovementEvent(step.fired, sign), sample.metric);
      this.eventCount += 1;
    }

    return {
      timestamp: ts,
      hasData: true,
      raw: sample.value,
      value,
      phase: step.phase,
      active: step.phase === "active",
      progress: step.progress,
      event,
      count: this.eventCount,
      metric: sample.metric,
    };
  }

  private triggerConfig(th: MetricThresholds): TriggerConfig {
    const sign = th.decreasing ? -1 : 1;
    return {
      mode: this.mode,
      enter: sign * th.enter,
      exit: sign * th.exit,
      minActiveFrames: this.temporal.minActiveFrames,
      minRestFrames: this.temporal.minRestFrames,
      minConfidence: this.temporal.minConfidence,
      maxActiveMs: this.maxActiveMs,
    };
  }

  private disarm(): void {
    this.smoother.reset();
    this.trigger = null;
    this.metric = null;
  }

  private empty(timestamp: number): DetectorResult<TEvent> & { readonly metric: TMetric | null } {
    const phase: DetectorPhase = "idle";
    return {
      timestamp,
      hasData: false,
      raw: null,
      value: null,
      phase,
      active: false,
      progress: 0,
      event: null,
      count: this.eventCount,
      metric: null,
    };
  }
}

/** Converts a trigger firing (in signed trigger units) into a base event in natural units. */
export function toMovementEvent(fired: TriggerFiring, sign: number): MovementEvent {
  return {
    type: "",
    timestamp: fired.timestamp,
    startedAt: fired.startedAt,
    durationMs: fired.timestamp - fired.startedAt,
    frames: fired.frames,
    peak: sign * fired.peak,
    confidence: fired.confidence,
  };
}
