import { CameraManager } from "../camera/CameraManager";
import { FaceAnalyzer } from "../analysis/FaceAnalyzer";
import type { FaceAnalyzerOptions } from "../types/analysis.types";
import type { ChallengeManagerOptions } from "../types/challenge.types";
import { FaceApiEngine } from "../engines/FaceApiEngine";
import type { FaceEngine } from "../engines/FaceEngine";
import { MediaPipeEngine } from "../engines/MediaPipeEngine";
import type {
  FacialCheckConfig,
  FrameAnalyzer,
  FrameScheduler,
  SessionCamera,
} from "../types/session.types";
import { FacialCheckError } from "./FacialCheckError";

export const FACIAL_CHECK_DEFAULTS = Object.freeze({
  engine: "face-api",
  maxFps: 15,
  maxDetectionErrors: 5,
  padMaxFrames: 3,
} as const);

/** Settings a `FacialSession` runs with, every default applied. */
export interface ResolvedFacialCheckConfig {
  readonly challengeOptions: ChallengeManagerOptions;
  readonly maxFps: number;
  readonly maxDetectionErrors: number;
  readonly padMaxFrames: number;
  readonly padTimeoutMs: number | undefined;
  readonly now: () => number;
  readonly createSessionId: (() => string) | undefined;
}

/**
 * Validates `config` and applies the defaults. Challenge options are passed
 * through to `ChallengeManager`, which validates them when a session starts.
 *
 * @throws {FacialCheckError} `INVALID_CONFIG`
 */
export function resolveFacialCheckConfig(config: FacialCheckConfig = {}): ResolvedFacialCheckConfig {
  const maxFps = config.maxFps ?? FACIAL_CHECK_DEFAULTS.maxFps;
  if (!(Number.isFinite(maxFps) && maxFps > 0)) invalid(`maxFps must be a positive number (got ${maxFps}).`);
  const maxDetectionErrors = config.maxDetectionErrors ?? FACIAL_CHECK_DEFAULTS.maxDetectionErrors;
  if (!(Number.isInteger(maxDetectionErrors) && maxDetectionErrors >= 1)) {
    invalid(`maxDetectionErrors must be an integer >= 1 (got ${maxDetectionErrors}).`);
  }
  const padMaxFrames = config.pad?.maxFrames ?? FACIAL_CHECK_DEFAULTS.padMaxFrames;
  if (!(Number.isInteger(padMaxFrames) && padMaxFrames >= 0)) {
    invalid(`pad.maxFrames must be an integer >= 0 (got ${padMaxFrames}).`);
  }
  const engine = config.engine ?? FACIAL_CHECK_DEFAULTS.engine;
  if (typeof engine === "string" && engine !== "face-api" && engine !== "mediapipe") {
    invalid(`unknown engine "${String(engine)}" (use "face-api", "mediapipe" or a FaceEngine).`);
  }

  const challengeOptions = stripUndefined({
    challenges: config.challenges,
    randomChallenges: config.randomChallenges,
    count: config.count,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    maxFaceLostMs: config.maxFaceLostMs,
    challengeSettings: config.challengeSettings,
    detectors: config.detectors,
    random: config.random,
  });

  return {
    challengeOptions,
    maxFps,
    maxDetectionErrors,
    padMaxFrames,
    padTimeoutMs: config.pad?.timeoutMs,
    now: config.now ?? Date.now,
    createSessionId: config.createSessionId,
  };
}

/** Engine selected by `config.engine` (face-api.js by default). */
export function createEngine(config: FacialCheckConfig): FaceEngine {
  const engine = config.engine ?? FACIAL_CHECK_DEFAULTS.engine;
  if (typeof engine !== "string") return engine;
  return engine === "mediapipe" ? new MediaPipeEngine(config.mediapipe) : new FaceApiEngine(config.faceApi);
}

export function createCamera(config: FacialCheckConfig): SessionCamera {
  const camera = config.camera;
  if (isSessionCamera(camera)) return camera;
  return new CameraManager(camera ?? {});
}

export function createAnalyzer(config: FacialCheckConfig): FrameAnalyzer {
  const analyzer = config.analyzer;
  if (analyzer !== undefined && typeof (analyzer as Partial<FrameAnalyzer>).analyze === "function") {
    return analyzer as FrameAnalyzer;
  }
  return new FaceAnalyzer((analyzer as FaceAnalyzerOptions | undefined) ?? {});
}

/** `requestAnimationFrame` when available, `setTimeout` otherwise. */
export function defaultScheduler(): FrameScheduler {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  if (typeof g.requestAnimationFrame === "function" && typeof g.cancelAnimationFrame === "function") {
    const raf = g.requestAnimationFrame.bind(globalThis);
    const caf = g.cancelAnimationFrame.bind(globalThis);
    return { request: (cb) => raf(cb), cancel: (handle) => caf(handle as number) };
  }
  return {
    request: (cb) => setTimeout(cb, 16),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function isSessionCamera(value: unknown): value is SessionCamera {
  return typeof value === "object" && value !== null && typeof (value as Partial<SessionCamera>).start === "function";
}

function invalid(message: string): never {
  throw new FacialCheckError("INVALID_CONFIG", `FacialCheck: ${message}`);
}

function stripUndefined(value: { [K in keyof ChallengeManagerOptions]-?: ChallengeManagerOptions[K] | undefined } | Record<string, unknown>): ChallengeManagerOptions {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as ChallengeManagerOptions;
}
