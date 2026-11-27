/**
 * Entry point: `facial-check/detectors`
 *
 * Standalone movement detectors (e.g. `BlinkDetector`, `MouthDetector`).
 * Symbols are added by the tasks that implement them.
 */
export { BlinkDetector } from "./BlinkDetector";
export { MouthDetector } from "./MouthDetector";
export { SmileDetector } from "./SmileDetector";
export { HeadPoseDetector, HEAD_MOVEMENTS } from "./HeadPoseDetector";
export { ExponentialMovingAverage } from "./smoothing";
export type * from "../types/detector.types";
