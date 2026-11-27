/**
 * Challenge engine types (TASK 07).
 *
 * A challenge asks the user for one movement (blink, open the mouth, smile,
 * turn or tilt the head) and is only completed when the matching movement
 * detector confirms it. Challenges are presence checks: they do not prove the
 * face is real and are independent of any PAD (Presentation Attack Detection).
 */

import type {
  BlinkDetectorOptions,
  DetectorInput,
  HeadPoseDetectorOptions,
  MouthDetectorOptions,
  SmileDetectorOptions,
} from "./detector.types";

/** Challenge ids of the public API. */
export type ChallengeType = "blink" | "open-mouth" | "smile" | "turn-left" | "turn-right" | "head-tilt";

/**
 * Lifecycle of one challenge:
 * `pending` → `active` → `completed` | `failed` | `timeout`.
 */
export type ChallengeStatus = "pending" | "active" | "completed" | "failed" | "timeout";

/** Why an attempt ended without the movement being confirmed. */
export type ChallengeFailureReason =
  /** The attempt ran past its timeout. */
  | "timeout"
  /** No face for longer than `maxFaceLostMs`. */
  | "face-lost"
  /** Ended by `ChallengeManager.stop()` or `failCurrent()`. */
  | "aborted";

/** Detector settings used to build each challenge. */
export interface ChallengeDetectorOptions {
  blink?: BlinkDetectorOptions;
  mouth?: MouthDetectorOptions;
  smile?: SmileDetectorOptions;
  /** Used by `turn-left`, `turn-right` and `head-tilt` (`movements` is set by each challenge). */
  headPose?: Omit<HeadPoseDetectorOptions, "movements">;
}

/** What a challenge reports after a frame. */
export interface ChallengeStep {
  /** Progress toward the movement being confirmed, from 0 to 1. */
  readonly progress: number;
  /** `true` on the frame where the detector confirmed the movement. */
  readonly completed: boolean;
  /** `false` when the frame had no usable face data. */
  readonly hasFace: boolean;
  /** Evidence of the confirmed movement, when `completed`. */
  readonly evidence: ChallengeEvidence | null;
}

/**
 * Summary of the detector event that validated a challenge. Only timing and
 * confidence are kept: no image, landmark or biometric measurement.
 */
export interface ChallengeEvidence {
  /** Detector event type (`blink`, `open-mouth`, `smile`, `head-movement`). */
  readonly detector: string;
  /** Head movement direction, for head challenges. */
  readonly direction?: string;
  readonly confidence: number;
  readonly durationMs: number;
  readonly frames: number;
  /** Timestamp (ms) of the frame that confirmed the movement. */
  readonly timestamp: number;
}

/** One challenge, backed by a movement detector. */
export interface Challenge {
  readonly type: ChallengeType;
  /** Feeds one frame. Call once per frame, in order. */
  update(input: DetectorInput, timestamp: number): ChallengeStep;
  /** Clears the detector state; called at the start of every attempt. */
  reset(): void;
}

/** Per-challenge settings. */
export interface ChallengeSettings {
  /** Time allowed for each attempt, in ms. */
  timeoutMs?: number;
  /** Number of attempts before the challenge is given up. */
  maxAttempts?: number;
  /** Longest time without a face, in ms, before the attempt fails with `face-lost`. */
  maxFaceLostMs?: number;
}

/** Factory used to build a challenge from the detector options. */
export type ChallengeFactory = (detectors: ChallengeDetectorOptions) => Challenge;

export interface ChallengeManagerOptions extends ChallengeSettings {
  /** Challenges to choose from. Default: every challenge of the catalog. */
  challenges?: readonly ChallengeType[];
  /** Shuffle the challenges for every session. Default: `true`. */
  randomChallenges?: boolean;
  /** How many challenges per session. Default: all of `challenges`. */
  count?: number;
  /** Overrides of `timeoutMs` / `maxAttempts` / `maxFaceLostMs` per challenge. */
  challengeSettings?: Partial<Record<ChallengeType, ChallengeSettings>>;
  /** Detector parameters. */
  detectors?: ChallengeDetectorOptions;
  /** Random source in `[0, 1)`, for the default randomizer. Default: `Math.random`. */
  random?: () => number;
  /** Clock used when no timestamp is passed. Default: `Date.now`. */
  now?: () => number;
  /** Session id generator. Default: `crypto.randomUUID()` when available. */
  createSessionId?: () => string;
  /** Replaces the catalog factories (e.g. custom detectors). */
  factories?: Partial<Record<ChallengeType, ChallengeFactory>>;
}

/** State of one challenge within a session. */
export interface ChallengeState {
  readonly sessionId: string;
  readonly type: ChallengeType;
  /** Position in the session sequence (0-based). */
  readonly index: number;
  readonly status: ChallengeStatus;
  /** Attempts started so far. */
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  /** Progress of the current attempt, from 0 to 1 (`1` once completed). */
  readonly progress: number;
  /** When the first attempt started. */
  readonly startedAt: number | null;
  /** When the current attempt started. */
  readonly attemptStartedAt: number | null;
  readonly endedAt: number | null;
  /** Reason of the last failed attempt, if any. */
  readonly failureReason: ChallengeFailureReason | null;
  readonly evidence: ChallengeEvidence | null;
}

/** Overall state of a `ChallengeManager`. */
export type ChallengeSessionStatus = "idle" | "running" | "passed" | "failed" | "stopped";

export interface ChallengeProgress {
  readonly sessionId: string;
  /** Challenges completed. */
  readonly completed: number;
  readonly total: number;
  /** Index of the active challenge, or `null`. */
  readonly currentIndex: number | null;
  readonly current: ChallengeType | null;
  /** Progress of the active challenge, from 0 to 1. */
  readonly challengeProgress: number;
  /** Overall progress, from 0 to 100. */
  readonly percent: number;
}

export interface ChallengeSessionResult {
  readonly sessionId: string;
  readonly status: ChallengeSessionStatus;
  /** `true` only when every challenge was completed. */
  readonly passed: boolean;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly challenges: readonly ChallengeState[];
}

export interface ChallengeStartedEvent {
  readonly sessionId: string;
  readonly challenge: ChallengeState;
}

export interface ChallengeCompletedEvent {
  readonly sessionId: string;
  readonly challenge: ChallengeState;
}

export interface ChallengeFailedEvent {
  readonly sessionId: string;
  readonly challenge: ChallengeState;
  readonly reason: ChallengeFailureReason;
  /** The attempt that failed (1-based). */
  readonly attempt: number;
  /** `true` when another attempt starts right away. */
  readonly willRetry: boolean;
}

/** Events emitted by `ChallengeManager`. */
export interface ChallengeManagerEvents {
  challengeStarted: ChallengeStartedEvent;
  challengeCompleted: ChallengeCompletedEvent;
  challengeFailed: ChallengeFailedEvent;
  progress: ChallengeProgress;
  /** The session ended (passed, failed or stopped). */
  finished: ChallengeSessionResult;
}

/** What `ChallengeManager.update()` returns. */
export interface ChallengeManagerStep {
  readonly status: ChallengeSessionStatus;
  readonly current: ChallengeState | null;
  readonly progress: ChallengeProgress;
}
