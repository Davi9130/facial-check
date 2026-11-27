import type { FaceAnalysis } from "../../src/types/analysis.types";

/** Frame period of a 30 fps camera, in ms. */
export const FRAME_MS = 33;

type Partial2<T> = { [K in keyof T]?: T[K] extends object | null ? Partial<NonNullable<T[K]>> | null : T[K] };

/** Minimal synthetic `FaceAnalysis` (only the fields detectors read are meaningful). */
export function analysis(timestamp: number, parts: Partial2<Pick<FaceAnalysis, "eyes" | "mouth" | "headPose">> = {}): FaceAnalysis {
  return {
    timestamp,
    faceDetected: true,
    faceCount: 1,
    score: 0.95,
    position: null,
    size: null,
    eyes:
      parts.eyes === null
        ? null
        : {
            left: { ear: 0.3, openness: 1, closed: false },
            right: { ear: 0.3, openness: 1, closed: false },
            averageEar: 0.3,
            openness: 1,
            bothClosed: false,
            source: "landmarks",
            ...parts.eyes,
          },
    mouth:
      parts.mouth === null
        ? null
        : {
            mar: 0.05,
            openness: 0.05,
            open: false,
            openSource: "landmarks",
            smileScore: 0,
            smiling: false,
            smileSource: "landmarks",
            ...parts.mouth,
          },
    headPose:
      parts.headPose === null
        ? null
        : { yaw: 0, pitch: 0, roll: 0, frontal: true, source: "engine", ...parts.headPose },
    stability: { stable: true, frames: 8, movement: 0, sizeChange: 0, jumped: false },
    issues: [],
    ready: true,
  };
}

/** Feeds `values` one per frame (30 fps, starting at `start`) and returns every result. */
export function feed<R>(values: readonly number[], toInput: (v: number, ts: number) => FaceAnalysis | null, update: (input: FaceAnalysis | null, ts: number) => R, start = 0): R[] {
  return values.map((v, i) => {
    const ts = start + i * FRAME_MS;
    return update(toInput(v, ts), ts);
  });
}

export const repeat = (value: number, n: number): number[] => Array.from({ length: n }, () => value);

export function events<T extends { event: unknown }>(results: readonly T[]): NonNullable<T["event"]>[] {
  return results.flatMap((r) => (r.event ? [r.event as NonNullable<T["event"]>] : []));
}
