import { useMemo } from "react";
import { FacialCheck } from "../../core/FacialCheck";
import { FacialCheckError, isFacialCheckError } from "../../core/FacialCheckError";
import type { FaceAnalysis, FaceAnalysisIssue } from "../../types/analysis.types";
import type {
  ChallengeCompletedEvent,
  ChallengeFailedEvent,
  ChallengeProgress,
  ChallengeStartedEvent,
  ChallengeState,
  ChallengeType,
} from "../../types/challenge.types";
import type {
  FaceDetectedEvent,
  FacialCheckConfig,
  FacialCheckErrorEvent,
  FacialCheckResult,
  FacialCheckStatus,
  FacialCheckStatusChange,
} from "../../types/session.types";
import { HookStore, omit } from "./HookStore";
import { useHookStore } from "./useHookStore";

/** Error exposed by `useFacialCheck` (a `FacialCheckError`). */
export type FacialCheckHookError = FacialCheckErrorEvent["error"];

/**
 * Options of `useFacialCheck`: the `FacialCheck` configuration plus callbacks.
 *
 * The configuration is read once, when the hook creates its `FacialCheck`
 * (after mount). To apply a new configuration, remount the component (e.g.
 * change its `key`). Callbacks can change on every render.
 */
export interface UseFacialCheckOptions extends FacialCheckConfig {
  /** Load the engine (models) as soon as the component mounts. Default: `false`. */
  autoInitialize?: boolean;
  /** Start a session as soon as the component mounts. Default: `false`. */
  autoStart?: boolean;
  onStatusChange?: (event: FacialCheckStatusChange) => void;
  onFaceDetected?: (event: FaceDetectedEvent) => void;
  /** Analysis of every processed frame. Does not re-render the component. */
  onFrame?: (analysis: FaceAnalysis) => void;
  onChallengeStarted?: (event: ChallengeStartedEvent) => void;
  onChallengeCompleted?: (event: ChallengeCompletedEvent) => void;
  onChallengeFailed?: (event: ChallengeFailedEvent) => void;
  onProgress?: (progress: ChallengeProgress) => void;
  /** The session ended on its own (`completed` or `failed`). */
  onCompleted?: (result: FacialCheckResult) => void;
  /** The session ended with every challenge completed. See `result.pad` for the PAD verdict. */
  onSuccess?: (result: FacialCheckResult) => void;
  /** The session ended with a failed challenge. */
  onFailure?: (result: FacialCheckResult) => void;
  onError?: (error: FacialCheckHookError, event: FacialCheckErrorEvent) => void;
}

export interface FacialCheckState {
  status: FacialCheckStatus;
  /** Id of the current (or last) session; empty before the first one. */
  sessionId: string;
  /** Whether a face is in front of the camera. */
  faceDetected: boolean;
  /** Whether the face is centered, at the right distance and still. */
  faceReady: boolean;
  /** What keeps the face from being ready (`"no-face"`, `"off-center"`, …). */
  faceIssues: readonly FaceAnalysisIssue[];
  /** Type of the active challenge, or `null`. */
  currentChallenge: ChallengeType | null;
  /** State of the active challenge, or `null`. */
  challenge: ChallengeState | null;
  /** Overall progress, from 0 to 100. */
  progress: number;
  progressDetails: ChallengeProgress | null;
  /** Result of the last session that ended on its own, or `null`. */
  result: FacialCheckResult | null;
  /** Last error of the current session (or of `initialize()`), or `null`. */
  error: FacialCheckHookError | null;
  /** The underlying instance, `null` until the component is mounted. */
  facialCheck: FacialCheck | null;
}

export interface UseFacialCheckResult extends FacialCheckState {
  /** Attach to the `<video>` that shows the camera: `<video ref={videoRef} />`. */
  videoRef: (video: HTMLVideoElement | null) => void;
  /** Loads the models. Never rejects: failures are reported in `error` / `onError`. */
  initialize: () => Promise<void>;
  /** Starts a new session. Never rejects: failures are reported in `error` / `onError`. */
  start: () => Promise<void>;
  /** Stops the running session and releases the camera. */
  stop: () => void;
}

const HOOK_OPTIONS = [
  "autoInitialize",
  "autoStart",
  "onStatusChange",
  "onFaceDetected",
  "onFrame",
  "onChallengeStarted",
  "onChallengeCompleted",
  "onChallengeFailed",
  "onProgress",
  "onCompleted",
  "onSuccess",
  "onFailure",
  "onError",
] as const satisfies readonly (keyof UseFacialCheckOptions)[];

const SESSION_RESET = {
  faceDetected: false,
  faceReady: false,
  faceIssues: [],
  currentChallenge: null,
  challenge: null,
  progress: 0,
  progressDetails: null,
  result: null,
  error: null,
} as const satisfies Partial<FacialCheckState>;

const INITIAL: FacialCheckState = { status: "idle", sessionId: "", ...SESSION_RESET, facialCheck: null };

export class FacialCheckStore extends HookStore<FacialCheckState, UseFacialCheckOptions> {
  private instance: FacialCheck | null = null;
  private video: HTMLVideoElement | null = null;

  constructor(options: UseFacialCheckOptions) {
    super(options, INITIAL);
  }

  readonly videoRef = (video: HTMLVideoElement | null): void => {
    this.video = video;
    const instance = this.instance;
    if (video && instance && instance.getStatus() !== "destroyed") instance.attachVideo(video);
  };

  readonly initialize = async (): Promise<void> => {
    const instance = this.current();
    if (!instance) return;
    try {
      await instance.initialize();
    } catch (error) {
      this.reportRejection(error);
    }
  };

  readonly start = async (): Promise<void> => {
    const instance = this.current();
    if (!instance) return;
    try {
      await instance.start();
    } catch (error) {
      this.reportRejection(error);
    }
  };

  readonly stop = (): void => {
    this.instance?.stop();
  };

  protected acquire(): void {
    const config = omit(this.options, HOOK_OPTIONS);
    if (this.video) config.video = this.video;

    let instance: FacialCheck;
    try {
      instance = new FacialCheck(config as FacialCheckConfig);
    } catch (error) {
      this.setState({ status: "error" });
      this.reportRejection(error);
      return;
    }
    this.instance = instance;
    this.listen(instance);
    this.setState({ ...INITIAL, status: instance.getStatus(), facialCheck: instance });

    if (this.options.autoStart) void this.start();
    else if (this.options.autoInitialize) void this.initialize();
  }

  protected release(): void {
    const instance = this.instance;
    this.instance = null;
    instance?.destroy();
    this.setState({ facialCheck: null });
  }

  private current(): FacialCheck | null {
    if (!this.ensureAcquired()) return null;
    const instance = this.instance;
    return instance && instance.getStatus() !== "destroyed" ? instance : null;
  }

  private listen(instance: FacialCheck): void {
    const mine = (): boolean => this.instance === instance;
    instance.on("statusChange", (event) => {
      if (!mine()) return;
      if (event.status === "starting") this.setState({ ...SESSION_RESET, sessionId: instance.sessionId });
      this.setState({ status: event.status });
      this.options.onStatusChange?.(event);
    });
    instance.on("faceDetected", (event) => {
      if (!mine()) return;
      this.setState({ faceDetected: event.detected, faceReady: event.ready, faceIssues: event.issues });
      this.options.onFaceDetected?.(event);
    });
    instance.on("frame", (analysis) => {
      if (mine()) this.options.onFrame?.(analysis);
    });
    instance.on("challengeStarted", (event) => {
      if (!mine()) return;
      this.setState({ challenge: event.challenge, currentChallenge: event.challenge.type });
      this.options.onChallengeStarted?.(event);
    });
    instance.on("challengeCompleted", (event) => {
      if (!mine()) return;
      this.setState({ challenge: event.challenge });
      this.options.onChallengeCompleted?.(event);
    });
    instance.on("challengeFailed", (event) => {
      if (!mine()) return;
      this.setState({ challenge: event.challenge });
      this.options.onChallengeFailed?.(event);
    });
    instance.on("progress", (progress) => {
      if (!mine()) return;
      const patch: Partial<FacialCheckState> = {
        progress: progress.percent,
        progressDetails: progress,
        currentChallenge: progress.current,
      };
      if (progress.current === null) patch.challenge = null;
      this.setState(patch);
      this.options.onProgress?.(progress);
    });
    instance.on("completed", (result) => {
      if (!mine()) return;
      this.setState({ result, currentChallenge: null, challenge: null });
      this.options.onCompleted?.(result);
      if (result.status === "completed") this.options.onSuccess?.(result);
      else if (result.status === "failed") this.options.onFailure?.(result);
    });
    instance.on("error", (event) => {
      if (!mine()) return;
      this.setState({ error: event.error });
      this.options.onError?.(event.error, event);
    });
  }

  /** Reports a rejected call unless the same error was already emitted as an `error` event. */
  private reportRejection(cause: unknown): void {
    if (cause === this.snapshot.error) return;
    const error = isFacialCheckError(cause)
      ? cause
      : new FacialCheckError("UNKNOWN", "FacialCheck: unexpected error.", { cause });
    this.setState({ error });
    this.options.onError?.(error, { sessionId: this.instance?.sessionId ?? "", error, fatal: true });
  }
}

/**
 * Headless Face Liveness: runs a `FacialCheck` for the component and mirrors
 * its state. Build any UI on top of it.
 *
 * ```tsx
 * const { status, faceDetected, currentChallenge, progress, start, stop, videoRef } = useFacialCheck({
 *   challenges: ["blink", "open-mouth", "turn-left", "turn-right"],
 *   onSuccess: (result) => send(result.sessionId),
 * });
 * return <video ref={videoRef} />;
 * ```
 *
 * The camera, the engine and every listener are released on unmount. The
 * instance is created once per mounted component (also under StrictMode).
 */
export function useFacialCheck(options: UseFacialCheckOptions = {}): UseFacialCheckResult {
  const [store, state] = useHookStore((o: UseFacialCheckOptions) => new FacialCheckStore(o), options);
  return useMemo(
    () => ({ ...state, videoRef: store.videoRef, initialize: store.initialize, start: store.start, stop: store.stop }),
    [state, store],
  );
}
