/**
 * Session and programmatic API types (TASK 09).
 *
 * The final result keeps two independent verdicts apart:
 * - `challenges`: the liveness *presence* challenges (did the user perform the
 *   requested movements?). Passing them does not prove the face is real.
 * - `pad`: the Presentation Attack Detection analysis, when a PAD is
 *   configured. `NO_ATTACK_DETECTED` is not an absolute proof of authenticity.
 */

import type { PadAnalysis } from "../pad/PadResult";
import type { PadInput } from "../pad/PadProvider";
import type { PadDetectOptions } from "../pad/PresentationAttackDetector";
import type { FaceAnalysis, FaceAnalysisIssue, FaceAnalyzerOptions } from "./analysis.types";
import type { CameraOptions } from "./camera.types";
import type {
  ChallengeCompletedEvent,
  ChallengeDetectorOptions,
  ChallengeFailedEvent,
  ChallengeProgress,
  ChallengeSessionResult,
  ChallengeSettings,
  ChallengeStartedEvent,
  ChallengeType,
} from "./challenge.types";
import type { FaceApiEngineOptions } from "../engines/FaceApiEngine";
import type { FaceEngine } from "../engines/FaceEngine";
import type { MediaPipeEngineOptions } from "../engines/MediaPipeEngine";
import type { FaceDetectionResult } from "./face.types";

/** Built-in engines selectable by name. */
export type FacialCheckEngineName = "face-api" | "mediapipe";

/**
 * Lifecycle of a `FacialCheck`:
 *
 * `idle` → `initializing` → `ready` → `starting` → `waiting-face` → `running`
 * → (`analyzing-pad`) → `completed` | `failed`.
 *
 * `stop()` leads to `stopped`, an unrecoverable problem to `error`; from
 * `ready`, `completed`, `failed`, `stopped` and `error` a new session can be
 * started. `destroy()` leads to `destroyed` (final).
 */
export type FacialCheckStatus =
  | "idle"
  | "initializing"
  | "ready"
  | "starting"
  /** Camera on, waiting for the first face before the first challenge starts. */
  | "waiting-face"
  | "running"
  /** Challenges ended; the PAD analysis is in progress. */
  | "analyzing-pad"
  /** Every challenge was completed (see `FacialCheckResult.pad` for PAD). */
  | "completed"
  /** A challenge failed (timeout, face lost, …). */
  | "failed"
  | "stopped"
  | "error"
  | "destroyed";

/** Status of one session (a `FacialCheck` status once the session exists). */
export type FacialSessionStatus = Extract<
  FacialCheckStatus,
  "starting" | "waiting-face" | "running" | "analyzing-pad" | "completed" | "failed" | "stopped" | "error"
>;

export type FacialCheckErrorCode =
  /** The camera could not be opened or stopped on its own. See `cause` (`CameraError`). */
  | "CAMERA_ERROR"
  /** The engine could not load or kept failing to detect. See `cause` (`FaceEngineError`). */
  | "ENGINE_ERROR"
  /** The PAD detector rejected (the challenge verdict is kept; `pad` is `null`). */
  | "PAD_ERROR"
  /** Invalid configuration. */
  | "INVALID_CONFIG"
  /** Method called in a state that does not allow it. */
  | "INVALID_STATE"
  /** The instance was destroyed. */
  | "DESTROYED"
  | "UNKNOWN";

/** Plain, serializable error description kept in results (no stack, no data). */
export interface FacialCheckErrorInfo {
  readonly code: FacialCheckErrorCode;
  readonly message: string;
}

/**
 * Minimal frame scheduler. The default uses `requestAnimationFrame` when
 * available and `setTimeout` otherwise; tests can drive frames by hand.
 */
export interface FrameScheduler {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

/** What a session needs from a frame analyzer (`FaceAnalyzer` satisfies it). */
export interface FrameAnalyzer {
  analyze(faces: readonly FaceDetectionResult[], timestamp: number): FaceAnalysis;
  reset(): void;
}

/** What a session needs from the camera (`CameraManager` satisfies it). */
export interface SessionCamera {
  readonly isActive: boolean;
  start(): Promise<MediaStream>;
  stop(): void;
  attach(video: HTMLVideoElement): Promise<void>;
  captureFrame(): HTMLCanvasElement;
}

/** What a session needs from a PAD (`PresentationAttackDetector` satisfies it). */
export interface SessionPad {
  analyze(input: PadInput, options?: PadDetectOptions): Promise<PadAnalysis>;
}

/** PAD settings of `FacialCheckConfig.pad`. */
export interface FacialCheckPadOptions {
  /** Most frames captured for the PAD per session (one per completed challenge). Default: `3`. */
  maxFrames?: number;
  /** Timeout of the PAD analysis, in ms. Default: the detector's own. */
  timeoutMs?: number;
}

/** Events of `FacialCheck` / `FacialSession`. */
export interface FacialCheckEvents {
  /** The face appeared (`detected: true`) or disappeared (`false`). Emitted on change only. */
  faceDetected: FaceDetectedEvent;
  /** Analysis of every processed frame (for guides / feedback UIs). */
  frame: FaceAnalysis;
  challengeStarted: ChallengeStartedEvent;
  challengeCompleted: ChallengeCompletedEvent;
  /** An attempt failed; `willRetry` tells whether another attempt starts. */
  challengeFailed: ChallengeFailedEvent;
  progress: ChallengeProgress;
  /** The session ended on its own (`completed` or `failed`), PAD included. */
  completed: FacialCheckResult;
  error: FacialCheckErrorEvent;
  statusChange: FacialCheckStatusChange;
}

export interface FaceDetectedEvent {
  readonly sessionId: string;
  readonly detected: boolean;
  readonly timestamp: number;
  readonly faceCount: number;
  /** `true` when the face is centered, at the right distance and still. */
  readonly ready: boolean;
  readonly issues: readonly FaceAnalysisIssue[];
}

export interface FacialCheckErrorEvent {
  /** Empty when the error happened outside a session (e.g. in `initialize()`). */
  readonly sessionId: string;
  readonly error: Error & { readonly code: FacialCheckErrorCode };
  /** `true` when the error ended the session. */
  readonly fatal: boolean;
}

export interface FacialCheckStatusChange {
  readonly status: FacialCheckStatus;
  readonly previous: FacialCheckStatus;
}

/** Final (or current) result of a session. */
export interface FacialCheckResult {
  /** Empty before the first session. */
  readonly sessionId: string;
  readonly status: FacialCheckStatus;
  /** Name of the engine used (`"face-api"`, `"mediapipe"`, …). */
  readonly engine: string;
  /** Epoch ms when `start()` was called. */
  readonly startedAt: number | null;
  /** Epoch ms when the first face was seen and the challenges started. */
  readonly challengesStartedAt: number | null;
  /** Epoch ms when the session ended. */
  readonly endedAt: number | null;
  readonly durationMs: number | null;
  /**
   * Presence challenges. `challenges.passed` only says the requested movements
   * were performed; it is not an anti-spoofing verdict.
   */
  readonly challenges: ChallengeSessionResult;
  /**
   * PAD analysis, independent of the challenges. `null` when no PAD is
   * configured or the session ended before it ran.
   */
  readonly pad: PadAnalysis | null;
  readonly error: FacialCheckErrorInfo | null;
}

/** Configuration of `FacialCheck`. Every field is optional. */
export interface FacialCheckConfig extends ChallengeSettings {
  /** Challenges of each session. Default: every challenge of the catalog. */
  challenges?: readonly ChallengeType[];
  /** Shuffle the challenges for every session. Default: `true`. */
  randomChallenges?: boolean;
  /** How many challenges per session. Default: all of `challenges`. */
  count?: number;
  challengeSettings?: Partial<Record<ChallengeType, ChallengeSettings>>;
  detectors?: ChallengeDetectorOptions;

  /**
   * Face engine: `"face-api"` (default, face-api.js) or `"mediapipe"`, or any
   * `FaceEngine` instance.
   */
  engine?: FacialCheckEngineName | FaceEngine;
  /** Options of the built-in `FaceApiEngine` (when `engine` is `"face-api"`). */
  faceApi?: FaceApiEngineOptions;
  /** Options of the built-in `MediaPipeEngine` (when `engine` is `"mediapipe"`). */
  mediapipe?: MediaPipeEngineOptions;

  /** Camera options, or a camera instance (e.g. a shared `CameraManager`). */
  camera?: CameraOptions | SessionCamera;
  /**
   * `<video>` that shows the camera and is read by the engine. Default: an
   * off-screen element created by the SDK. Can also be set with `attachVideo()`.
   */
  video?: HTMLVideoElement;

  /** `FaceAnalyzer` options, or a custom analyzer. */
  analyzer?: FaceAnalyzerOptions | FrameAnalyzer;

  /**
   * Optional Presentation Attack Detector. It runs after the challenges, on a
   * few frames captured in memory during the session (dropped right after).
   * Its verdict is reported in `result.pad`, separately from the challenges.
   */
  padDetector?: SessionPad;
  pad?: FacialCheckPadOptions;

  /** Upper bound of processed frames per second. Default: `15`. */
  maxFps?: number;
  /**
   * Consecutive failed detections tolerated before the session ends with
   * `ENGINE_ERROR`. Default: `5`.
   */
  maxDetectionErrors?: number;

  /** Clock (epoch ms). Default: `Date.now`. */
  now?: () => number;
  /** Session id generator. Default: `crypto.randomUUID()` when available. */
  createSessionId?: () => string;
  /** Random source in `[0, 1)` for the challenge order. Default: `Math.random`. */
  random?: () => number;
  /** Frame scheduler. Default: `requestAnimationFrame` / `setTimeout`. */
  scheduler?: FrameScheduler;
}

