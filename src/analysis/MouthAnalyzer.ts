import type { FaceDetectionResult } from "../types/face.types";
import type { FaceMetricSource, MouthAnalysis, MouthAnalyzerOptions } from "../types/analysis.types";
import { blendshape, clamp, distance, pointsToPixels, type Vec2 } from "./geometry";

const DEFAULTS: Required<MouthAnalyzerOptions> = {
  preferBlendshapes: true,
  openMarThreshold: 0.35,
  wideOpenMar: 0.7,
  jawOpenThreshold: 0.4,
  neutralMouthWidthRatio: 0.54,
  smileMouthWidthRatio: 0.7,
  smileThreshold: 0.5,
};

/**
 * Mouth Aspect Ratio: mean lip gap over mouth width.
 *
 * - 8 inner-lip points (iBUG 60–67): `(|p2-p8| + |p3-p7| + |p4-p6|) / (2·|p1-p5|)`;
 * - 12 outer-lip points (iBUG 48–59): same formula on points 50/58, 51/57, 52/56 and corners 48/54.
 *
 * Points must be in pixels (or any uniform scale). Returns `null` for other
 * point counts or a degenerate mouth.
 */
export function computeMouthAspectRatio(mouth: readonly Vec2[]): number | null {
  let corners: readonly [number, number];
  let pairs: readonly (readonly [number, number])[];
  if (mouth.length === 8) {
    corners = [0, 4];
    pairs = [[1, 7], [2, 6], [3, 5]];
  } else if (mouth.length === 12) {
    corners = [0, 6];
    pairs = [[2, 10], [3, 9], [4, 8]];
  } else {
    return null;
  }
  const a = mouth[corners[0]];
  const b = mouth[corners[1]];
  if (!a || !b) return null;
  const width = distance(a, b);
  if (width === 0) return null;
  let gap = 0;
  for (const [i, j] of pairs) {
    const p = mouth[i];
    const q = mouth[j];
    if (!p || !q) return null;
    gap += distance(p, q);
  }
  return gap / (2 * width);
}

/**
 * Mouth opening and smile from a `FaceDetectionResult`. Uses `jawOpen` and
 * `mouthSmileLeft/Right` blendshapes when available (and preferred), otherwise
 * the landmarks: MAR for opening, and mouth width relative to the outer eye
 * corners for the smile (a heuristic; temporal smoothing belongs to the detectors).
 */
export class MouthAnalyzer {
  private readonly options: Required<MouthAnalyzerOptions>;

  constructor(options: MouthAnalyzerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Returns `null` when the face has neither usable blendshapes nor mouth landmarks. */
  analyze(face: FaceDetectionResult): MouthAnalysis | null {
    const o = this.options;
    const regions = face.landmarks?.regions;

    let mar: number | null = null;
    let widthRatio: number | null = null;
    if (regions) {
      const inner = pointsToPixels(regions.mouthInner, face.imageSize);
      const outer = pointsToPixels(regions.mouthOuter, face.imageSize);
      mar = computeMouthAspectRatio(inner) ?? computeMouthAspectRatio(outer);
      widthRatio = mouthWidthRatio(outer, pointsToPixels(regions.rightEye, face.imageSize), pointsToPixels(regions.leftEye, face.imageSize));
    }

    const jawOpen = blendshape(face.blendshapes, "jawOpen");
    const smileLeft = blendshape(face.blendshapes, "mouthSmileLeft");
    const smileRight = blendshape(face.blendshapes, "mouthSmileRight");
    const smileBlend = smileLeft !== undefined && smileRight !== undefined ? (smileLeft + smileRight) / 2 : undefined;

    let openSource: FaceMetricSource;
    let openness: number;
    let open: boolean;
    if (jawOpen !== undefined && (o.preferBlendshapes || mar === null)) {
      openSource = "blendshapes";
      openness = clamp(jawOpen);
      open = jawOpen >= o.jawOpenThreshold;
    } else if (mar !== null) {
      openSource = "landmarks";
      openness = clamp(mar / o.wideOpenMar);
      open = mar >= o.openMarThreshold;
    } else {
      return null;
    }

    let smileSource: FaceMetricSource;
    let smileScore: number;
    if (smileBlend !== undefined && (o.preferBlendshapes || widthRatio === null)) {
      smileSource = "blendshapes";
      smileScore = clamp(smileBlend);
    } else if (widthRatio !== null) {
      smileSource = "landmarks";
      const span = o.smileMouthWidthRatio - o.neutralMouthWidthRatio;
      smileScore = span > 0 ? clamp((widthRatio - o.neutralMouthWidthRatio) / span) : 0;
    } else {
      // Opening is known but nothing tells us about the smile.
      smileSource = openSource;
      smileScore = 0;
    }

    return {
      mar,
      openness,
      open,
      openSource,
      smileScore,
      smiling: smileScore >= o.smileThreshold,
      smileSource,
    };
  }
}

/** Mouth corner distance over outer eye corner distance (scale-invariant). */
function mouthWidthRatio(outerMouth: readonly Vec2[], rightEye: readonly Vec2[], leftEye: readonly Vec2[]): number | null {
  const leftCorner = outerMouth[0];
  const rightCorner = outerMouth[6];
  // iBUG: rightEye[0] (36) and leftEye[3] (45) are the outer eye corners.
  const rightOuter = rightEye[0];
  const leftOuter = leftEye[3];
  if (outerMouth.length !== 12 || !leftCorner || !rightCorner || !rightOuter || !leftOuter) return null;
  const eyes = distance(rightOuter, leftOuter);
  return eyes > 0 ? distance(leftCorner, rightCorner) / eyes : null;
}
