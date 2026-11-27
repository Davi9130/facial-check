/**
 * Movement detector types (TASK 06).
 *
 * Detectors turn a stream of per-frame analyses into **movement events**
 * (a blink, an open mouth, a smile, a head turn). Every event needs several
 * consecutive frames: values are smoothed over time, thresholds use
 * hysteresis, and the detector must first see the face at rest. A single
 * noisy frame never produces an event.
 *
 * Detectors accept either a `FaceAnalysis` (from `FaceAnalyzer`) or a raw
 * `FaceDetectionResult` (from any `FaceEngine`), and are independent of the
 * challenge engine and of any UI.
 */

import type { FaceAnalysis, EyeAnalyzerOptions, HeadPoseAnalyzerOptions, MouthAnalyzerOptions } from "./analysis.types";
import type { FaceDetectionResult } from "./face.types";

/** What a detector consumes each frame. `null` / `undefined` means no face in this frame. */
export type DetectorInput = FaceAnalysis | FaceDetectionResult | null | undefined;

/**
 * Where a detector is in its cycle:
 * - `idle`: not armed yet, waiting to see the face at rest for `minRestFrames`;
 * - `ready`: armed, face at rest;
 * - `active`: the movement is happening (threshold crossed, not confirmed yet or held);
 * - `cooldown`: an event was emitted (or the movement was rejected) and the face must return to rest.
 */
export type DetectorPhase = "idle" | "ready" | "active" | "cooldown";

/** Temporal settings shared by every detector. */
export interface TemporalDetectorOptions {
  /**
   * Exponential moving average factor, in `(0, 1]`. Lower values smooth more;
   * `1` disables smoothing.
   */
  smoothing?: number;
  /** Consecutive frames past the activation threshold needed to count the movement. */
  minActiveFrames?: number;
  /** Consecutive frames at rest needed to arm the detector (and, for blinks, to confirm the reopening). */
  minRestFrames?: number;
  /** Events with a confidence below this (0–1) are discarded. */
  minConfidence?: number;
  /** Time without frames, in milliseconds, after which the detector disarms and starts over. */
  maxFrameGapMs?: number;
}

/** One detected movement. */
export interface MovementEvent<TType extends string = string> {
  readonly type: TType;
  /** Timestamp (ms) of the frame that confirmed the event. */
  readonly timestamp: number;
  /** Timestamp (ms) of the first frame past the activation threshold. */
  readonly startedAt: number;
  /** `timestamp - startedAt`, in milliseconds. */
  readonly durationMs: number;
  /** Frames past the activation threshold. */
  readonly frames: number;
  /** Most extreme smoothed value reached during the movement (in the detector's own unit). */
  readonly peak: number;
  /**
   * How sure the detector is, from 0 to 1: half from how far the movement went
   * past the threshold, half from how many frames it lasted.
   */
  readonly confidence: number;
}

/** State of a detector after a frame. */
export interface DetectorResult<TEvent extends MovementEvent = MovementEvent> {
  readonly timestamp: number;
  /** `false` when the frame had no usable face data; the detector disarms. */
  readonly hasData: boolean;
  /** Raw signal of this frame (detector unit), or `null` without data. */
  readonly raw: number | null;
  /** Smoothed signal, or `null` without data. */
  readonly value: number | null;
  readonly phase: DetectorPhase;
  /** `true` while the movement is happening. */
  readonly active: boolean;
  /** Progress toward confirming the current movement, from 0 to 1. */
  readonly progress: number;
  /** Event confirmed on this frame, if any. */
  readonly event: TEvent | null;
  /** Events confirmed since creation or the last `reset()`. */
  readonly count: number;
}

// ---------------------------------------------------------------- Blink

export type BlinkMetric = "ear" | "openness";

export type BlinkEvent = MovementEvent<"blink"> & {
  /** Signal used: Eye Aspect Ratio (landmarks) or eye openness (blendshapes). */
  readonly metric: BlinkMetric;
};

export interface BlinkDetectorOptions extends TemporalDetectorOptions {
  /** Smoothed EAR below which the eyes count as closed. Default: `0.2`. */
  closedEar?: number;
  /** Smoothed EAR above which the eyes count as open again (hysteresis). Default: `0.25`. */
  openEar?: number;
  /** Smoothed eye openness (0–1) below which the eyes count as closed, when no EAR is used. Default: `0.4`. */
  closedOpenness?: number;
  /** Smoothed eye openness (0–1) above which the eyes count as open again. Default: `0.6`. */
  openOpenness?: number;
  /** Longest time the eyes may stay closed for it to still count as a blink. Default: `700`. */
  maxClosedMs?: number;
  /** Used to analyze raw `FaceDetectionResult` inputs. */
  eyes?: EyeAnalyzerOptions;
}

export type BlinkDetectorResult = DetectorResult<BlinkEvent> & {
  readonly metric: BlinkMetric | null;
};

// ---------------------------------------------------------------- Mouth

export type MouthMetric = "mar" | "openness";

export type MouthOpenEvent = MovementEvent<"open-mouth"> & {
  /** Signal used: Mouth Aspect Ratio (landmarks) or `jawOpen` openness (blendshapes). */
  readonly metric: MouthMetric;
};

export interface MouthDetectorOptions extends TemporalDetectorOptions {
  /** Smoothed MAR at or above which the mouth counts as open. Default: `0.35`. */
  openMar?: number;
  /** Smoothed MAR below which the mouth counts as closed again (hysteresis). Default: `0.25`. */
  closedMar?: number;
  /** Smoothed openness (0–1) at or above which the mouth counts as open, when no MAR is used. Default: `0.4`. */
  openOpenness?: number;
  /** Smoothed openness (0–1) below which the mouth counts as closed again. Default: `0.25`. */
  closedOpenness?: number;
  /** Used to analyze raw `FaceDetectionResult` inputs. */
  mouth?: MouthAnalyzerOptions;
}

export type MouthDetectorResult = DetectorResult<MouthOpenEvent> & {
  readonly metric: MouthMetric | null;
};

// ---------------------------------------------------------------- Smile

export type SmileEvent = MovementEvent<"smile">;

export interface SmileDetectorOptions extends TemporalDetectorOptions {
  /** Smoothed smile score (0–1) at or above which the face counts as smiling. Default: `0.5`. */
  smileThreshold?: number;
  /** Smoothed smile score below which the face counts as neutral again (hysteresis). Default: `0.3`. */
  neutralThreshold?: number;
  /** Used to analyze raw `FaceDetectionResult` inputs. */
  mouth?: MouthAnalyzerOptions;
}

export type SmileDetectorResult = DetectorResult<SmileEvent>;

// ---------------------------------------------------------------- Head pose

/** Head movements, in the subject's own directions. */
export type HeadMovement = "turn-left" | "turn-right" | "look-up" | "look-down" | "tilt-left" | "tilt-right";

export type HeadMovementEvent = MovementEvent<"head-movement"> & {
  readonly direction: HeadMovement;
};

export interface HeadPoseThresholds {
  /** Smoothed |angle| (degrees) at or above which the movement counts. */
  enter?: number;
  /** Smoothed |angle| below which the head is back at rest on this axis (hysteresis). */
  exit?: number;
}

export interface HeadPoseDetectorOptions extends TemporalDetectorOptions {
  /** Movements to detect. Default: all. */
  movements?: readonly HeadMovement[];
  /** Yaw thresholds (turn left / right). Default: `{ enter: 20, exit: 10 }`. */
  yaw?: HeadPoseThresholds;
  /** Pitch thresholds (look up / down). Default: `{ enter: 15, exit: 8 }`. */
  pitch?: HeadPoseThresholds;
  /** Roll thresholds (tilt left / right). Default: `{ enter: 15, exit: 8 }`. */
  roll?: HeadPoseThresholds;
  /** Used to analyze raw `FaceDetectionResult` inputs. */
  headPose?: HeadPoseAnalyzerOptions;
}

export interface SmoothedHeadPose {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export type HeadPoseDetectorResult = Omit<DetectorResult<HeadMovementEvent>, "raw" | "value" | "phase" | "active" | "progress"> & {
  /** Raw pose of this frame, or `null` without data. */
  readonly raw: SmoothedHeadPose | null;
  /** Smoothed pose, or `null` without data. */
  readonly pose: SmoothedHeadPose | null;
  /** Phase of each enabled movement. */
  readonly phases: Readonly<Partial<Record<HeadMovement, DetectorPhase>>>;
  /** Movement currently happening (the most advanced one), if any. */
  readonly activeMovement: HeadMovement | null;
  /** Progress of the most advanced movement, from 0 to 1. */
  readonly progress: number;
  /** All events confirmed on this frame (usually zero or one). */
  readonly events: readonly HeadMovementEvent[];
  /** Events confirmed per movement since creation or the last `reset()`. */
  readonly counts: Readonly<Partial<Record<HeadMovement, number>>>;
};
