/**
 * Engine-agnostic face detection types.
 *
 * Every `FaceEngine` (face-api.js, MediaPipe, …) returns these shapes, so the
 * analysis, detectors and challenges never depend on a specific engine.
 *
 * Coordinates are **normalized** to the input frame: `x` and `y` go from 0 to 1,
 * where (0, 0) is the top-left corner of the frame. Multiply by `imageSize` to
 * get pixels. Sides (`left` / `right`) are always the **subject's** own sides,
 * not the sides of the image.
 */

/** Media that an engine can read a frame from. */
export type FaceEngineInput = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/** A landmark point, normalized to the frame. `z` is only set by 3D engines (e.g. MediaPipe). */
export interface FacePoint {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/** Axis-aligned bounding box, normalized to the frame and clamped to [0, 1]. */
export interface FaceBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Size, in pixels, of the frame the result was computed from. */
export interface FaceImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Landmarks grouped by facial region.
 *
 * Point order inside each region follows the iBUG 68-point layout, which is
 * what the eye (EAR) and mouth (MAR) metrics expect:
 * - eyes: 6 points `[p1, p2, p3, p4, p5, p6]`, where `p1`/`p4` are the corners,
 *   `p2`/`p3` the upper lid and `p6`/`p5` the lower lid (so EAR =
 *   (|p2-p6| + |p3-p5|) / (2·|p1-p4|)). `p1` is the corner nearest the left edge of the image;
 * - `mouthOuter`: 12 points, `mouthInner`: 8 points, starting at the subject's right corner;
 * - `jawline`: 17 points from the subject's right ear to the left ear.
 *
 * Engines with denser meshes map a subset of their points to this layout.
 */
export interface FaceLandmarkRegions {
  readonly jawline: readonly FacePoint[];
  readonly rightEyebrow: readonly FacePoint[];
  readonly leftEyebrow: readonly FacePoint[];
  readonly nose: readonly FacePoint[];
  readonly rightEye: readonly FacePoint[];
  readonly leftEye: readonly FacePoint[];
  readonly mouthOuter: readonly FacePoint[];
  readonly mouthInner: readonly FacePoint[];
}

export interface FaceLandmarks {
  /** Every point the engine produced, in the engine's native order. */
  readonly points: readonly FacePoint[];
  /** The same points grouped by region (see `FaceLandmarkRegions`). */
  readonly regions: FaceLandmarkRegions;
}

/**
 * Expression coefficients from 0 to 1, keyed by name
 * (e.g. MediaPipe's `eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`).
 */
export type FaceBlendshapes = Readonly<Record<string, number>>;

/**
 * Head rotation in degrees, relative to looking straight at the camera.
 * - `yaw` > 0: the subject turns their head to their own right;
 * - `pitch` > 0: the subject looks up;
 * - `roll` > 0: the subject tilts their head toward their own right shoulder.
 */
export interface HeadPose {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /** Optional 4x4 column-major transformation matrix, when the engine provides one. */
  readonly transformationMatrix?: readonly number[];
}

/** One detected face. */
export interface FaceDetectionResult {
  /** Face bounding box, normalized to the frame. */
  readonly box: FaceBoundingBox;
  /** Detection confidence, from 0 to 1. */
  readonly score: number;
  /** Size of the frame this result refers to, in pixels. */
  readonly imageSize: FaceImageSize;
  /** Present when the engine computed landmarks. */
  readonly landmarks?: FaceLandmarks;
  /** Present when the engine supports blendshapes (e.g. MediaPipe). */
  readonly blendshapes?: FaceBlendshapes;
  /** Present when the engine estimates head pose (e.g. MediaPipe). */
  readonly pose?: HeadPose;
}
