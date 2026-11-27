/**
 * Facial analysis types (TASK 05).
 *
 * `FaceAnalyzer` turns the raw `FaceDetectionResult`s of any engine into a
 * `FaceAnalysis`: is there a face, is it centered and at the right distance,
 * are the eyes and mouth open, where is the head pointing, and is the face
 * stable over the last frames.
 *
 * All positions and sizes are **normalized** to the frame (0–1), like
 * `FaceDetectionResult`. Angles are in degrees. Sides are the subject's own sides.
 */

/** Where a metric came from: engine blendshapes or the geometry of the landmarks. */
export type FaceMetricSource = "blendshapes" | "landmarks";

/** Where the head pose came from: the engine itself or an estimate from the landmarks. */
export type HeadPoseSource = "engine" | "landmarks";

/** Problems that keep the face from being ready for capture or challenges. */
export type FaceAnalysisIssue =
  | "no-face"
  | "multiple-faces"
  | "not-centered"
  | "too-close"
  | "too-far"
  | "partially-visible"
  | "unstable";

export interface FacePositionAnalysis {
  /** Center of the face box, normalized to the frame. */
  readonly centerX: number;
  readonly centerY: number;
  /** Distance from the guide center (`> 0`: face is to the right of / below the guide in the image). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** `true` when both offsets are within the configured tolerance. */
  readonly centered: boolean;
  /** `false` when the face box touches an edge of the frame (part of the face is cut off). */
  readonly fullyVisible: boolean;
}

export type FaceDistanceStatus = "too-far" | "ok" | "too-close";

export interface FaceSizeAnalysis {
  /** Face box height as a fraction of the frame height. */
  readonly ratio: number;
  readonly status: FaceDistanceStatus;
}

export interface EyeState {
  /** Eye Aspect Ratio. `null` when the engine gave no landmarks for this eye. */
  readonly ear: number | null;
  /** How open the eye is, from 0 (closed) to 1 (fully open). */
  readonly openness: number;
  readonly closed: boolean;
}

export interface EyeAnalysis {
  readonly left: EyeState;
  readonly right: EyeState;
  /** Mean EAR of both eyes, or `null` without landmarks. */
  readonly averageEar: number | null;
  /** Mean openness of both eyes, from 0 to 1. */
  readonly openness: number;
  readonly bothClosed: boolean;
  /** Source used to decide `closed` / `openness`. */
  readonly source: FaceMetricSource;
}

export interface MouthAnalysis {
  /** Mouth Aspect Ratio. `null` when the engine gave no mouth landmarks. */
  readonly mar: number | null;
  /** How open the mouth is, from 0 (closed) to 1 (wide open). */
  readonly openness: number;
  readonly open: boolean;
  readonly openSource: FaceMetricSource;
  /** Smile intensity, from 0 (neutral) to 1 (broad smile). */
  readonly smileScore: number;
  readonly smiling: boolean;
  readonly smileSource: FaceMetricSource;
}

export interface HeadPoseAnalysis {
  /** Degrees; `> 0` when the subject turns their head to their own right. */
  readonly yaw: number;
  /** Degrees; `> 0` when the subject looks up. */
  readonly pitch: number;
  /** Degrees; `> 0` when the subject tilts their head toward their own right shoulder. */
  readonly roll: number;
  /** `true` when every angle is within the configured frontal limits. */
  readonly frontal: boolean;
  readonly source: HeadPoseSource;
}

export interface FaceStabilityAnalysis {
  /** `true` once the face stayed still for a full window of frames. */
  readonly stable: boolean;
  /** Consecutive frames currently in the window. */
  readonly frames: number;
  /** Largest distance of the face center from its mean position in the window (normalized). */
  readonly movement: number;
  /** Largest relative change of the face size from its mean in the window. */
  readonly sizeChange: number;
  /** `true` when this frame jumped too far from the previous one, restarting the window. */
  readonly jumped: boolean;
}

/** Analysis of one frame. Sub-analyses are `null` when there is no face or the engine lacks the data. */
export interface FaceAnalysis {
  /** Timestamp of the frame, in milliseconds. */
  readonly timestamp: number;
  readonly faceDetected: boolean;
  /** Number of faces at or above the minimum score. */
  readonly faceCount: number;
  /** Detection score of the analyzed (highest-scoring) face. */
  readonly score: number | null;
  readonly position: FacePositionAnalysis | null;
  readonly size: FaceSizeAnalysis | null;
  readonly eyes: EyeAnalysis | null;
  readonly mouth: MouthAnalysis | null;
  readonly headPose: HeadPoseAnalysis | null;
  readonly stability: FaceStabilityAnalysis;
  /** Everything that currently keeps the face from being ready, in a stable order. */
  readonly issues: readonly FaceAnalysisIssue[];
  /** `true` when `issues` is empty: one centered, fully visible face at the right distance, holding still. */
  readonly ready: boolean;
}

export interface EyeAnalyzerOptions {
  /** Use `eyeBlinkLeft` / `eyeBlinkRight` blendshapes when the engine provides them. Default: `true`. */
  preferBlendshapes?: boolean;
  /** EAR below which an eye counts as closed. Default: `0.2`. */
  closedEarThreshold?: number;
  /** EAR of a fully open eye, used to scale `openness`. Default: `0.3`. */
  openEar?: number;
  /** Blink blendshape at or above which an eye counts as closed. Default: `0.5`. */
  blinkBlendshapeThreshold?: number;
}

export interface MouthAnalyzerOptions {
  /** Use `jawOpen` / `mouthSmileLeft` / `mouthSmileRight` blendshapes when available. Default: `true`. */
  preferBlendshapes?: boolean;
  /** MAR at or above which the mouth counts as open. Default: `0.35`. */
  openMarThreshold?: number;
  /** MAR of a wide-open mouth, used to scale `openness`. Default: `0.7`. */
  wideOpenMar?: number;
  /** `jawOpen` blendshape at or above which the mouth counts as open. Default: `0.4`. */
  jawOpenThreshold?: number;
  /** Mouth width / outer eye-corner distance of a neutral face. Default: `0.54`. */
  neutralMouthWidthRatio?: number;
  /** Mouth width / outer eye-corner distance of a broad smile. Default: `0.7`. */
  smileMouthWidthRatio?: number;
  /** `smileScore` at or above which the face counts as smiling. Default: `0.5`. */
  smileThreshold?: number;
}

export interface HeadPoseAnalyzerOptions {
  /** Use the pose computed by the engine when present. Default: `true`. */
  preferEnginePose?: boolean;
  /** Largest |yaw| still considered frontal. Default: `15`. */
  maxFrontalYaw?: number;
  /** Largest |pitch| still considered frontal. Default: `15`. */
  maxFrontalPitch?: number;
  /** Largest |roll| still considered frontal. Default: `15`. */
  maxFrontalRoll?: number;
}

export interface FaceGuide {
  /** Guide center, normalized to the frame. Default: `0.5`. */
  centerX?: number;
  /** Default: `0.5`. */
  centerY?: number;
  /** Largest offset from the guide center still considered centered. Default: `0.12`. */
  tolerance?: number;
}

export interface FaceStabilityOptions {
  /** Consecutive frames the face must hold still. Default: `8`. */
  windowSize?: number;
  /** Largest distance of the center from its mean in the window. Default: `0.025`. */
  maxMovement?: number;
  /** Largest relative size change from the mean in the window. Default: `0.08`. */
  maxSizeChange?: number;
  /** Center distance between two consecutive frames that counts as a jump and restarts the window. Default: `0.08`. */
  maxJump?: number;
  /** Time without frames, in milliseconds, after which the window restarts. Default: `1000`. */
  maxFrameGapMs?: number;
}

export interface FaceAnalyzerOptions {
  /** Faces below this detection score are ignored. Default: `0`. */
  minScore?: number;
  guide?: FaceGuide;
  /** Smallest face height / frame height; below it the face is too far. Default: `0.25`. */
  minFaceSize?: number;
  /** Largest face height / frame height; above it the face is too close. Default: `0.75`. */
  maxFaceSize?: number;
  stability?: FaceStabilityOptions;
  eyes?: EyeAnalyzerOptions;
  mouth?: MouthAnalyzerOptions;
  headPose?: HeadPoseAnalyzerOptions;
}
