import type { FaceDetectionResult, HeadPose } from "../types/face.types";
import type { HeadPoseAnalysis, HeadPoseAnalyzerOptions, HeadPoseSource } from "../types/analysis.types";
import { centroid, dot, midpoint, pointsToPixels, radToDeg, subtract, type Vec2 } from "./geometry";

const DEFAULTS: Required<HeadPoseAnalyzerOptions> = {
  preferEnginePose: true,
  maxFrontalYaw: 15,
  maxFrontalPitch: 15,
  maxFrontalRoll: 15,
};

/**
 * Proportions of an average adult head (in cm, relative), used to turn 2D
 * landmark offsets into angles. The estimate is approximate (a few degrees on
 * an average face); prefer an engine pose when one is available.
 */
const REFERENCE_FACE = {
  /** Half the distance between the jaw ends (iBUG 0 and 16). */
  jawHalfWidth: 7,
  /** Depth of the nose tip in front of the jaw ends. */
  noseDepthFromJaw: 10,
  /** Height of the nose tip below the eye line, and its depth in front of the eyes. */
  noseBelowEyes: 4,
  noseDepthFromEyes: 3.5,
  /** Height of the chin below the eye line, and its depth in front of the eyes. */
  chinBelowEyes: 11.5,
  chinDepthFromEyes: 0.5,
} as const;

/**
 * Estimates yaw, pitch and roll (degrees) from 68-point landmarks.
 *
 * - roll: angle of the line between the eye centers;
 * - yaw: horizontal shift of the nose tip from the midpoint of the jaw ends;
 * - pitch: position of the nose tip between the eye line and the chin.
 *
 * Offsets are measured along the face's own axes, so roll does not leak into
 * yaw or pitch. Expects an unmirrored frame (the subject's right eye on the
 * image's left), which is what engines read from the camera. Returns `null`
 * when the landmarks are incomplete.
 */
export function estimateHeadPoseFromLandmarks(face: FaceDetectionResult): HeadPose | null {
  const regions = face.landmarks?.regions;
  if (!regions) return null;
  const size = face.imageSize;
  const jaw = pointsToPixels(regions.jawline, size);
  const nose = pointsToPixels(regions.nose, size);
  const rightEye = pointsToPixels(regions.rightEye, size);
  const leftEye = pointsToPixels(regions.leftEye, size);
  const jawRight = jaw[0];
  const jawLeft = jaw[16];
  const chin = jaw[8];
  const noseTip = nose[3];
  if (!jawRight || !jawLeft || !chin || !noseTip || rightEye.length < 6 || leftEye.length < 6) return null;

  const rightEyeCenter = centroid(rightEye);
  const leftEyeCenter = centroid(leftEye);
  const eyeVector = subtract(leftEyeCenter, rightEyeCenter);
  const eyeDistance = Math.hypot(eyeVector.x, eyeVector.y);
  if (eyeDistance === 0) return null;

  // u: toward the subject's left (image right when unmirrored); v: down the face.
  const u: Vec2 = { x: eyeVector.x / eyeDistance, y: eyeVector.y / eyeDistance };
  const v: Vec2 = { x: -u.y, y: u.x };
  const roll = -radToDeg(Math.atan2(u.y, u.x));

  const jawMid = midpoint(jawRight, jawLeft);
  const jawHalfWidth = dot(subtract(jawLeft, jawRight), u) / 2;
  if (jawHalfWidth <= 0) return null;
  const yawRatio = dot(subtract(noseTip, jawMid), u) / jawHalfWidth;
  const yaw = radToDeg(Math.atan((-yawRatio * REFERENCE_FACE.jawHalfWidth) / REFERENCE_FACE.noseDepthFromJaw));

  const eyeMid = midpoint(rightEyeCenter, leftEyeCenter);
  const noseDown = dot(subtract(noseTip, eyeMid), v);
  const chinDown = dot(subtract(chin, eyeMid), v);
  if (chinDown <= 0) return null;
  const r = noseDown / chinDown;
  const f = REFERENCE_FACE;
  // Solves r = (Hn·cos − Dn·sin) / (Hc·cos − Dc·sin) for tan(pitch).
  const pitch = radToDeg(
    Math.atan2(f.noseBelowEyes - r * f.chinBelowEyes, f.noseDepthFromEyes - r * f.chinDepthFromEyes),
  );

  return { yaw, pitch, roll };
}

/**
 * Head pose from a `FaceDetectionResult`: the engine pose when present (and
 * preferred), otherwise an estimate from the landmarks.
 */
export class HeadPoseAnalyzer {
  private readonly options: Required<HeadPoseAnalyzerOptions>;

  constructor(options: HeadPoseAnalyzerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Returns `null` when the face has neither an engine pose nor usable landmarks. */
  analyze(face: FaceDetectionResult): HeadPoseAnalysis | null {
    let pose: HeadPose | null;
    let source: HeadPoseSource = "engine";
    if (face.pose && this.options.preferEnginePose) {
      pose = face.pose;
    } else {
      pose = estimateHeadPoseFromLandmarks(face);
      source = "landmarks";
      if (!pose && face.pose) {
        pose = face.pose;
        source = "engine";
      }
    }
    if (!pose) return null;

    const o = this.options;
    return {
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      frontal:
        Math.abs(pose.yaw) <= o.maxFrontalYaw &&
        Math.abs(pose.pitch) <= o.maxFrontalPitch &&
        Math.abs(pose.roll) <= o.maxFrontalRoll,
      source,
    };
  }
}
