import { useMemo } from "react";
import { ChallengeManager, type ChallengeStartOptions } from "../../challenges/ChallengeManager";
import type {
  ChallengeCompletedEvent,
  ChallengeFailedEvent,
  ChallengeManagerOptions,
  ChallengeManagerStep,
  ChallengeProgress,
  ChallengeSessionResult,
  ChallengeSessionStatus,
  ChallengeStartedEvent,
  ChallengeState,
  ChallengeType,
} from "../../types/challenge.types";
import type { DetectorInput } from "../../types/detector.types";
import { HookStore, omit } from "./HookStore";
import { useHookStore } from "./useHookStore";

/**
 * Options of `useLivenessChallenges`: the `ChallengeManager` options plus
 * callbacks. Manager options are read once, when the hook creates it (after
 * mount); callbacks can change on every render.
 */
export interface UseLivenessChallengesOptions extends ChallengeManagerOptions {
  /** Start a session as soon as the component mounts. Default: `false`. */
  autoStart?: boolean;
  onChallengeStarted?: (event: ChallengeStartedEvent) => void;
  onChallengeCompleted?: (event: ChallengeCompletedEvent) => void;
  onChallengeFailed?: (event: ChallengeFailedEvent) => void;
  onProgress?: (progress: ChallengeProgress) => void;
  /** The session ended (passed, failed or stopped). */
  onFinished?: (result: ChallengeSessionResult) => void;
  /** The options are invalid (unknown challenge, bad `count`, …). */
  onError?: (error: Error) => void;
}

export interface LivenessChallengesState {
  status: ChallengeSessionStatus;
  sessionId: string;
  /** Type of the active challenge, or `null`. */
  currentChallenge: ChallengeType | null;
  /** State of the active challenge, or `null`. */
  challenge: ChallengeState | null;
  /** Every challenge of the session, in order. */
  challenges: readonly ChallengeState[];
  /** Overall progress, from 0 to 100. */
  progress: number;
  progressDetails: ChallengeProgress | null;
  /** Result once the session ended, or `null`. */
  result: ChallengeSessionResult | null;
  error: Error | null;
  /** The underlying manager, `null` until the component is mounted. */
  manager: ChallengeManager | null;
}

export interface UseLivenessChallengesResult extends LivenessChallengesState {
  /** Starts a new session (a new random order when `randomChallenges`). */
  start: (options?: ChallengeStartOptions) => void;
  /** Feeds one frame (e.g. `useFaceDetection().analysis`). Returns `null` when not mounted. */
  update: (input: DetectorInput, timestamp?: number) => ChallengeManagerStep | null;
  /** Advances time without a frame (timeouts). */
  tick: (timestamp?: number) => void;
  stop: (timestamp?: number) => void;
  /** Back to `idle`, clearing the session. */
  reset: () => void;
}

const HOOK_OPTIONS = [
  "autoStart",
  "onChallengeStarted",
  "onChallengeCompleted",
  "onChallengeFailed",
  "onProgress",
  "onFinished",
  "onError",
] as const satisfies readonly (keyof UseLivenessChallengesOptions)[];

const INITIAL: LivenessChallengesState = {
  status: "idle",
  sessionId: "",
  currentChallenge: null,
  challenge: null,
  challenges: [],
  progress: 0,
  progressDetails: null,
  result: null,
  error: null,
  manager: null,
};

export class LivenessChallengesStore extends HookStore<LivenessChallengesState, UseLivenessChallengesOptions> {
  private manager: ChallengeManager | null = null;

  constructor(options: UseLivenessChallengesOptions) {
    super(options, INITIAL);
  }

  readonly start = (options?: ChallengeStartOptions): void => {
    const manager = this.current();
    if (!manager) return;
    manager.start(options);
    this.sync();
  };

  readonly update = (input: DetectorInput, timestamp?: number): ChallengeManagerStep | null => {
    const manager = this.current();
    return manager ? manager.update(input, timestamp) : null;
  };

  readonly tick = (timestamp?: number): void => {
    this.current()?.tick(timestamp);
  };

  readonly stop = (timestamp?: number): void => {
    const manager = this.current();
    if (!manager) return;
    manager.stop(timestamp);
    this.sync();
  };

  readonly reset = (): void => {
    const manager = this.current();
    if (!manager) return;
    manager.reset();
    this.sync();
  };

  protected acquire(): void {
    const config = omit(this.options, HOOK_OPTIONS);
    let manager: ChallengeManager;
    try {
      manager = new ChallengeManager(config as ChallengeManagerOptions);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.setState({ error });
      this.options.onError?.(error);
      return;
    }
    this.manager = manager;
    const mine = (): boolean => this.manager === manager;
    manager.on("challengeStarted", (event) => {
      if (!mine()) return;
      this.sync();
      this.options.onChallengeStarted?.(event);
    });
    manager.on("challengeCompleted", (event) => {
      if (!mine()) return;
      this.sync();
      this.options.onChallengeCompleted?.(event);
    });
    manager.on("challengeFailed", (event) => {
      if (!mine()) return;
      this.sync();
      this.options.onChallengeFailed?.(event);
    });
    manager.on("progress", (progress) => {
      if (!mine()) return;
      this.sync();
      this.options.onProgress?.(progress);
    });
    manager.on("finished", (result) => {
      if (!mine()) return;
      this.sync();
      this.options.onFinished?.(result);
    });
    this.setState({ ...INITIAL, manager });
    this.sync();
    if (this.options.autoStart) this.start();
  }

  protected release(): void {
    const manager = this.manager;
    this.manager = null;
    manager?.destroy();
    this.setState({ manager: null });
  }

  private current(): ChallengeManager | null {
    return this.ensureAcquired() ? this.manager : null;
  }

  private sync(): void {
    const manager = this.manager;
    if (!manager) return;
    const status = manager.getStatus();
    const challenge = manager.getCurrentChallenge();
    const progress = manager.getProgress();
    const ended = status === "passed" || status === "failed" || status === "stopped";
    this.setState({
      status,
      sessionId: manager.sessionId,
      challenge,
      currentChallenge: challenge?.type ?? null,
      challenges: manager.getChallenges(),
      progress: progress.percent,
      progressDetails: progress,
      result: ended ? manager.getResult() : null,
    });
  }
}

/**
 * Liveness challenge engine for the component, driven by your own frames.
 * Pairs with `useFaceDetection` to build a custom flow:
 *
 * ```tsx
 * const challenges = useLivenessChallenges({ challenges: ["blink", "smile"], autoStart: true });
 * useFaceDetection({ video, onResult: (analysis) => challenges.update(analysis, analysis.timestamp) });
 * return <p>{challenges.currentChallenge} — {challenges.progress}%</p>;
 * ```
 *
 * It has no camera, engine or PAD of its own; the manager is destroyed on unmount.
 */
export function useLivenessChallenges(options: UseLivenessChallengesOptions = {}): UseLivenessChallengesResult {
  const [store, state] = useHookStore(
    (o: UseLivenessChallengesOptions) => new LivenessChallengesStore(o),
    options,
  );
  return useMemo(
    () => ({
      ...state,
      start: store.start,
      update: store.update,
      tick: store.tick,
      stop: store.stop,
      reset: store.reset,
    }),
    [state, store],
  );
}
