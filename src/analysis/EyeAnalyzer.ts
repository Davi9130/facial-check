import type { FaceDetectionResult, FacePoint } from "../types/face.types";
import type { EyeAnalysis, EyeAnalyzerOptions, EyeState, FaceMetricSource } from "../types/analysis.types";
import { blendshape, clamp, distance, pointsToPixels, type Vec2 } from "./geometry";

const DEFAULTS: Required<EyeAnalyzerOptions> = {
  preferBlendshapes: true,
  closedEarThreshold: 0.2,
  openEar: 0.3,
  blinkBlendshapeThreshold: 0.5,
};

/**
 * Eye Aspect Ratio (Soukupová & Čech, 2016) of a 6-point eye in iBUG order
 * `[p1..p6]`: `(|p2-p6| + |p3-p5|) / (2·|p1-p4|)`.
 * Points must be in pixels (or any uniform scale). Returns `null` for fewer
 * than 6 points or a degenerate eye.
 */
export function computeEyeAspectRatio(eye: readonly Vec2[]): number | null {
  const [p1, p2, p3, p4, p5, p6] = eye;
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;
  const width = distance(p1, p4);
  if (width === 0) return null;
  return (distance(p2, p6) + distance(p3, p5)) / (2 * width);
}

/**
 * Eye openness from a `FaceDetectionResult`. Uses the engine's blink
 * blendshapes when available (and preferred), otherwise the EAR of the landmarks.
 * Engine-agnostic and independent of any UI.
 */
export class EyeAnalyzer {
  private readonly options: Required<EyeAnalyzerOptions>;

  constructor(options: EyeAnalyzerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Returns `null` when the face has neither usable blink blendshapes nor eye landmarks. */
  analyze(face: FaceDetectionResult): EyeAnalysis | null {
    const regions = face.landmarks?.regions;
    const leftEar = regions ? this.ear(regions.leftEye, face) : null;
    const rightEar = regions ? this.ear(regions.rightEye, face) : null;

    const blinkLeft = blendshape(face.blendshapes, "eyeBlinkLeft");
    const blinkRight = blendshape(face.blendshapes, "eyeBlinkRight");
    const hasBlendshapes = blinkLeft !== undefined && blinkRight !== undefined;
    const hasLandmarks = leftEar !== null && rightEar !== null;

    let source: FaceMetricSource;
    if (hasBlendshapes && (this.options.preferBlendshapes || !hasLandmarks)) source = "blendshapes";
    else if (hasLandmarks) source = "landmarks";
    else return null;

    const left = source === "blendshapes" ? this.fromBlink(blinkLeft ?? 0, leftEar) : this.fromEar(leftEar ?? 0);
    const right = source === "blendshapes" ? this.fromBlink(blinkRight ?? 0, rightEar) : this.fromEar(rightEar ?? 0);

    return {
      left,
      right,
      averageEar: hasLandmarks ? ((leftEar ?? 0) + (rightEar ?? 0)) / 2 : null,
      openness: (left.openness + right.openness) / 2,
      bothClosed: left.closed && right.closed,
      source,
    };
  }

  private ear(points: readonly FacePoint[], face: FaceDetectionResult): number | null {
    return computeEyeAspectRatio(pointsToPixels(points, face.imageSize));
  }

  private fromEar(ear: number): EyeState {
    return {
      ear,
      openness: clamp(ear / this.options.openEar),
      closed: ear < this.options.closedEarThreshold,
    };
  }

  private fromBlink(blink: number, ear: number | null): EyeState {
    return {
      ear,
      openness: clamp(1 - blink),
      closed: blink >= this.options.blinkBlendshapeThreshold,
    };
  }
}
