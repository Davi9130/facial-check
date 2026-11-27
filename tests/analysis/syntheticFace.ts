import type { FaceBlendshapes, FaceDetectionResult, FacePoint, HeadPose } from "../../src/types/face.types";

/**
 * Builds a synthetic 68-point face (iBUG layout) from a simple 3D head model,
 * rotates it and projects it orthographically into a frame. Units of the model
 * are centimeters; image is unmirrored (subject's right eye on the image left).
 */
export interface SyntheticFaceOptions {
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Half height of each eye opening, in cm. Open ≈ 0.5, closed ≈ 0.05. */
  eyeOpen?: number;
  leftEyeOpen?: number;
  rightEyeOpen?: number;
  /** Inner-lip gap, in cm. Closed = 0, wide open ≈ 2.5. */
  mouthGap?: number;
  /** 0 = neutral, 1 = broad smile. */
  smile?: number;
  /** Face center in the frame, normalized. */
  centerX?: number;
  centerY?: number;
  /** Pixels per cm. */
  scale?: number;
  imageWidth?: number;
  imageHeight?: number;
  score?: number;
  blendshapes?: FaceBlendshapes;
  pose?: HeadPose;
  withLandmarks?: boolean;
}

type P3 = readonly [number, number, number];

function eye(cx: number, open: number): P3[] {
  const y = -2.5;
  const z = 2.5;
  // p1 (image-left corner), p2, p3 upper lid, p4 (image-right corner), p5, p6 lower lid.
  return [
    [cx - 1.4, y, z],
    [cx - 0.5, y - open, z],
    [cx + 0.5, y - open, z],
    [cx + 1.4, y, z],
    [cx + 0.5, y + open, z],
    [cx - 0.5, y + open, z],
  ];
}

function model(o: Required<Pick<SyntheticFaceOptions, "mouthGap" | "smile">> & { left: number; right: number }): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i < 17; i++) {
    const t = (Math.PI * i) / 16;
    pts.push([-7 * Math.cos(t), -1 + 10 * Math.sin(t), -4 + 7 * Math.sin(t)]);
  }
  for (let i = 0; i < 5; i++) pts.push([-5.5 + i, -4, 3]);
  for (let i = 0; i < 5; i++) pts.push([1.5 + i, -4, 3]);
  pts.push([0, -2.5, 3], [0, -1.2, 4], [0, 0.2, 5], [0, 1.5, 6]);
  for (let i = 0; i < 5; i++) pts.push([-1.5 + 0.75 * i, 2.3, i === 2 ? 5 : 4.5]);
  pts.push(...eye(-3.2, o.right), ...eye(3.2, o.left));

  const my = 4.5;
  const half = 2.5 + 0.8 * o.smile;
  const lift = 0.6 * o.smile;
  const g = o.mouthGap / 2;
  // Outer lip 48–59.
  pts.push([-half, my - lift, 3.5]);
  for (const [x, dy] of [[-1.6, 0.6], [-0.8, 0.8], [0, 0.7], [0.8, 0.8], [1.6, 0.6]] as const) pts.push([x, my - g - dy, 4]);
  pts.push([half, my - lift, 3.5]);
  for (const [x, dy] of [[1.6, 0.6], [0.8, 0.8], [0, 0.8], [-0.8, 0.8], [-1.6, 0.6]] as const) pts.push([x, my + g + dy, 4]);
  // Inner lip 60–67.
  const inner = half - 0.5;
  pts.push([-inner, my - lift, 3.6], [-0.8, my - g, 3.8], [0, my - g, 3.8], [0.8, my - g, 3.8]);
  pts.push([inner, my - lift, 3.6], [0.8, my + g, 3.8], [0, my + g, 3.8], [-0.8, my + g, 3.8]);
  return pts;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

function rotate([x0, y0, z0]: P3, yaw: number, pitch: number, roll: number): P3 {
  // Pitch (look up > 0), then yaw (turn to own right > 0), then roll (tilt to own right shoulder > 0).
  const p = rad(pitch);
  let y = y0 * Math.cos(p) - z0 * Math.sin(p);
  let z = y0 * Math.sin(p) + z0 * Math.cos(p);
  const w = rad(yaw);
  let x = x0 * Math.cos(w) - z * Math.sin(w);
  z = x0 * Math.sin(w) + z * Math.cos(w);
  const r = rad(roll);
  const xr = x * Math.cos(r) + y * Math.sin(r);
  y = -x * Math.sin(r) + y * Math.cos(r);
  x = xr;
  return [x, y, z];
}

export function syntheticFace(options: SyntheticFaceOptions = {}): FaceDetectionResult {
  const width = options.imageWidth ?? 640;
  const height = options.imageHeight ?? 480;
  const scale = options.scale ?? 12;
  const cx = (options.centerX ?? 0.5) * width;
  const cy = (options.centerY ?? 0.5) * height;
  const open = options.eyeOpen ?? 0.5;

  const projected = model({
    left: options.leftEyeOpen ?? open,
    right: options.rightEyeOpen ?? open,
    mouthGap: options.mouthGap ?? 0,
    smile: options.smile ?? 0,
  }).map((p) => rotate(p, options.yaw ?? 0, options.pitch ?? 0, options.roll ?? 0));

  // Model y = 2.5 is roughly the middle of the face (brows at -4, chin at 9).
  const points: FacePoint[] = projected.map(([x, y]) => ({ x: (cx + x * scale) / width, y: (cy + (y - 2.5) * scale) / height }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const top = Math.min(...ys) - (1.5 * scale) / height;
  const box = { x: Math.min(...xs), y: top, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - top };

  const slice = (a: number, b: number): FacePoint[] => points.slice(a, b);
  const result: FaceDetectionResult = {
    box,
    score: options.score ?? 0.95,
    imageSize: { width, height },
    ...(options.withLandmarks === false
      ? {}
      : {
          landmarks: {
            points,
            regions: {
              jawline: slice(0, 17),
              rightEyebrow: slice(17, 22),
              leftEyebrow: slice(22, 27),
              nose: slice(27, 36),
              rightEye: slice(36, 42),
              leftEye: slice(42, 48),
              mouthOuter: slice(48, 60),
              mouthInner: slice(60, 68),
            },
          },
        }),
    ...(options.blendshapes ? { blendshapes: options.blendshapes } : {}),
    ...(options.pose ? { pose: options.pose } : {}),
  };
  return result;
}

/** A face with only a box, as returned by an engine without landmarks. */
export function boxOnlyFace(box: { x: number; y: number; width: number; height: number }, score = 0.9): FaceDetectionResult {
  return { box, score, imageSize: { width: 640, height: 480 } };
}
