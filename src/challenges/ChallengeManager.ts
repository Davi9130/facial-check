import { EventEmitter, type Listener } from "../core/EventEmitter";
import type {
  Challenge,
  ChallengeDetectorOptions,
  ChallengeEvidence,
  ChallengeFactory,
  ChallengeFailureReason,
  ChallengeManagerEvents,
  ChallengeManagerOptions,
  ChallengeManagerStep,
  ChallengeProgress,
  ChallengeSessionResult,
  ChallengeSessionStatus,
  ChallengeSettings,
  ChallengeState,
  ChallengeStatus,
  ChallengeType,
} from "../types/challenge.types";
import type { DetectorInput } from "../types/detector.types";
import { CHALLENGE_FACTORIES, CHALLENGE_TYPES, isChallengeType } from "./catalog";
import { ChallengeRandomizer } from "./ChallengeRandomizer";

const DEFAULT_SETTINGS: Readonly<Required<ChallengeSettings>> = {
  timeoutMs: 8000,
  maxAttempts: 2,
  maxFaceLostMs: 1500,
};

interface Slot {
  readonly type: ChallengeType;
  readonly index: number;
  readonly challenge: Challenge;
  readonly settings: Readonly<Required<ChallengeSettings>>;
  status: ChallengeStatus;
  attempts: number;
  progress: number;
  startedAt: number | null;
  attemptStartedAt: number | null;
  endedAt: number | null;
  /** Last frame with a face in the current attempt (or the attempt start). */
  lastFaceAt: number | null;
  failureReason: ChallengeFailureReason | null;
  evidence: ChallengeEvidence | null;
}

export interface ChallengeStartOptions {
  /** Id that every event and result of this session carries. Default: generated. */
  sessionId?: string;
  /** Start time, in ms. Default: `now()`. */
  timestamp?: number;
}

/**
 * Runs a sequence of liveness challenges, one at a time.
 *
 * Feed it one frame at a time (`update(analysis, timestamp)`); the active
 * challenge only completes when its movement detector confirms the movement,
 * so the sequence never advances on its own. Each attempt has a timeout and a
 * face-lost limit; failed attempts are retried up to `maxAttempts`, then the
 * challenge ends as `timeout` / `failed` and the session fails.
 *
 * Time is driven by the frame timestamps (or `tick()`), not by internal
 * timers, so it is deterministic and easy to test. It does not depend on any
 * PAD, UI or camera.
 *
 * ```ts
 * const manager = new ChallengeManager({ challenges: ["blink", "turn-left"], randomChallenges: true });
 * manager.on("challengeStarted", ({ challenge }) => showInstruction(challenge.type));
 * manager.on("finished", (result) => console.info(result.passed));
 * manager.start();
 * // every frame:
 * manager.update(analyzer.analyze(faces, now), now);
 * ```
 */
export class ChallengeManager {
  private readonly events = new EventEmitter<ChallengeManagerEvents>();
  private readonly pool: readonly ChallengeType[];
  private readonly count: number;
  private readonly randomChallenges: boolean;
  private readonly randomizer: ChallengeRandomizer;
  private readonly baseSettings: Readonly<Required<ChallengeSettings>>;
  private readonly perChallenge: Partial<Record<ChallengeType, ChallengeSettings>>;
  private readonly detectors: ChallengeDetectorOptions;
  private readonly factories: Readonly<Record<ChallengeType, ChallengeFactory>>;
  private readonly now: () => number;
  private readonly createSessionId: () => string;

  private status: ChallengeSessionStatus = "idle";
  private id = "";
  private slots: Slot[] = [];
  private current = -1;
  private startedAt: number | null = null;
  private endedAt: number | null = null;

  constructor(options: ChallengeManagerOptions = {}) {
    const pool = [...new Set(options.challenges ?? CHALLENGE_TYPES)];
    for (const t of pool) {
      if (!isChallengeType(t)) throw new RangeError(`ChallengeManager: unknown challenge "${String(t)}".`);
    }
    if (pool.length === 0) throw new RangeError("ChallengeManager: at least one challenge is required.");
    this.pool = pool;

    const count = options.count ?? pool.length;
    if (!(Number.isInteger(count) && count >= 1 && count <= pool.length)) {
      throw new RangeError(`ChallengeManager: count must be an integer between 1 and ${pool.length}.`);
    }
    this.count = count;

    this.randomChallenges = options.randomChallenges ?? true;
    this.randomizer = new ChallengeRandomizer(options.random ? { random: options.random } : {});
    this.baseSettings = resolveSettings(options, DEFAULT_SETTINGS);
    this.perChallenge = options.challengeSettings ?? {};
    for (const t of pool) resolveSettings(this.perChallenge[t] ?? {}, this.baseSettings);
    this.detectors = options.detectors ?? {};
    this.factories = { ...CHALLENGE_FACTORIES, ...options.factories };
    this.now = options.now ?? Date.now;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
  }

  /** Id of the current (or last) session; empty before the first `start()`. */
  get sessionId(): string {
    return this.id;
  }

  getStatus(): ChallengeSessionStatus {
    return this.status;
  }

  on<K extends keyof ChallengeManagerEvents>(event: K, listener: Listener<ChallengeManagerEvents[K]>): () => void {
    return this.events.on(event, listener);
  }

  once<K extends keyof ChallengeManagerEvents>(event: K, listener: Listener<ChallengeManagerEvents[K]>): () => void {
    return this.events.once(event, listener);
  }

  off<K extends keyof ChallengeManagerEvents>(event: K, listener: Listener<ChallengeManagerEvents[K]>): void {
    this.events.off(event, listener);
  }

  /**
   * Starts a new session: picks the challenges (shuffled when
   * `randomChallenges`), and activates the first one. A running session is
   * stopped first.
   */
  start(options: ChallengeStartOptions = {}): ChallengeManagerStep {
    if (this.status === "running") this.stop();
    const ts = options.timestamp ?? this.now();
    this.id = options.sessionId ?? this.createSessionId();
    const sequence = this.randomChallenges ? this.randomizer.pick(this.pool, this.count) : this.pool.slice(0, this.count);
    this.slots = sequence.map((type, index) => ({
      type,
      index,
      challenge: this.factories[type](this.detectors),
      settings: resolveSettings(this.perChallenge[type] ?? {}, this.baseSettings),
      status: "pending",
      attempts: 0,
      progress: 0,
      startedAt: null,
      attemptStartedAt: null,
      endedAt: null,
      lastFaceAt: null,
      failureReason: null,
      evidence: null,
    }));
    this.status = "running";
    this.startedAt = ts;
    this.endedAt = null;
    this.current = -1;
    this.activateNext(ts);
    return this.step();
  }

  /**
   * Feeds one frame to the active challenge. `null` / `undefined` means no
   * face in this frame. Does nothing unless a session is running.
   */
  update(input: DetectorInput, timestamp?: number): ChallengeManagerStep {
    const slot = this.active();
    if (!slot) return this.step();
    const ts = timestamp ?? (input && "faceDetected" in input ? input.timestamp : this.now());

    if (this.checkLimits(slot, ts)) return this.afterFrame();

    const step = slot.challenge.update(input, ts);
    if (step.hasFace) slot.lastFaceAt = ts;

    if (step.completed) {
      slot.status = "completed";
      slot.progress = 1;
      slot.endedAt = ts;
      slot.evidence = step.evidence;
      slot.failureReason = null;
      this.events.emit("challengeCompleted", { sessionId: this.id, challenge: this.snapshot(slot) });
      this.activateNext(ts);
      return this.afterFrame();
    }

    slot.progress = Math.min(0.99, Math.max(0, step.progress));
    return this.afterFrame();
  }

  /** Checks the timeout / face-lost limits without a frame (e.g. from a timer when frames stop). */
  tick(timestamp: number = this.now()): ChallengeManagerStep {
    const slot = this.active();
    if (slot && this.checkLimits(slot, timestamp)) return this.afterFrame();
    return this.step();
  }

  /**
   * Fails the current attempt with `aborted` (e.g. the host detected a
   * problem). It is retried if attempts remain.
   */
  failCurrent(timestamp: number = this.now()): ChallengeManagerStep {
    const slot = this.active();
    if (slot) this.failAttempt(slot, "aborted", timestamp);
    return this.afterFrame();
  }

  /** Stops the session: the active challenge fails with `aborted`, pending ones stay `pending`. */
  stop(timestamp: number = this.now()): void {
    if (this.status !== "running") return;
    const slot = this.active();
    if (slot) {
      slot.status = "failed";
      slot.failureReason = "aborted";
      slot.endedAt = timestamp;
      this.events.emit("challengeFailed", {
        sessionId: this.id,
        challenge: this.snapshot(slot),
        reason: "aborted",
        attempt: slot.attempts,
        willRetry: false,
      });
    }
    this.finish("stopped", timestamp);
  }

  /** Back to `idle`, forgetting the session (listeners are kept). */
  reset(): void {
    this.status = "idle";
    this.id = "";
    this.slots = [];
    this.current = -1;
    this.startedAt = null;
    this.endedAt = null;
    this.randomizer.reset();
  }

  /** Removes every listener and resets. */
  destroy(): void {
    this.reset();
    this.events.removeAllListeners();
  }

  /** The active challenge, or `null`. */
  getCurrentChallenge(): ChallengeState | null {
    const slot = this.active();
    return slot ? this.snapshot(slot) : null;
  }

  /** State of every challenge of the session, in order. */
  getChallenges(): ChallengeState[] {
    return this.slots.map((s) => this.snapshot(s));
  }

  getProgress(): ChallengeProgress {
    const total = this.slots.length;
    const completed = this.slots.filter((s) => s.status === "completed").length;
    const slot = this.active();
    const challengeProgress = slot ? slot.progress : 0;
    return {
      sessionId: this.id,
      completed,
      total,
      currentIndex: slot ? slot.index : null,
      current: slot ? slot.type : null,
      challengeProgress,
      percent: total === 0 ? 0 : Math.round(((completed + challengeProgress) / total) * 1000) / 10,
    };
  }

  getResult(): ChallengeSessionResult {
    return {
      sessionId: this.id,
      status: this.status,
      passed: this.status === "passed",
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      challenges: this.getChallenges(),
    };
  }

  // ------------------------------------------------------------------ internals

  private active(): Slot | null {
    if (this.status !== "running") return null;
    const slot = this.slots[this.current];
    return slot && slot.status === "active" ? slot : null;
  }

  /** Applies the timeout and face-lost limits. Returns `true` when the attempt failed. */
  private checkLimits(slot: Slot, ts: number): boolean {
    const started = slot.attemptStartedAt ?? ts;
    if (ts - started >= slot.settings.timeoutMs) {
      this.failAttempt(slot, "timeout", ts);
      return true;
    }
    const lastFace = slot.lastFaceAt ?? started;
    if (ts - lastFace > slot.settings.maxFaceLostMs) {
      this.failAttempt(slot, "face-lost", ts);
      return true;
    }
    return false;
  }

  private failAttempt(slot: Slot, reason: ChallengeFailureReason, ts: number): void {
    const willRetry = slot.attempts < slot.settings.maxAttempts;
    slot.failureReason = reason;
    if (!willRetry) {
      slot.status = reason === "timeout" ? "timeout" : "failed";
      slot.endedAt = ts;
    }
    this.events.emit("challengeFailed", {
      sessionId: this.id,
      challenge: this.snapshot(slot),
      reason,
      attempt: slot.attempts,
      willRetry,
    });
    if (willRetry) this.beginAttempt(slot, ts);
    else this.finish("failed", ts);
  }

  private activateNext(ts: number): void {
    const next = this.slots[this.current + 1];
    if (!next) {
      this.finish("passed", ts);
      return;
    }
    this.current += 1;
    next.status = "active";
    next.startedAt = ts;
    this.beginAttempt(next, ts);
    this.events.emit("challengeStarted", { sessionId: this.id, challenge: this.snapshot(next) });
  }

  private beginAttempt(slot: Slot, ts: number): void {
    slot.attempts += 1;
    slot.attemptStartedAt = ts;
    slot.lastFaceAt = ts;
    slot.progress = 0;
    // Fresh detector state: the movement must be performed within this attempt.
    slot.challenge.reset();
  }

  private finish(status: Exclude<ChallengeSessionStatus, "idle" | "running">, ts: number): void {
    this.status = status;
    this.endedAt = ts;
    this.events.emit("progress", this.getProgress());
    this.events.emit("finished", this.getResult());
  }

  private afterFrame(): ChallengeManagerStep {
    if (this.status === "running") this.events.emit("progress", this.getProgress());
    return this.step();
  }

  private step(): ChallengeManagerStep {
    return { status: this.status, current: this.getCurrentChallenge(), progress: this.getProgress() };
  }

  private snapshot(slot: Slot): ChallengeState {
    return {
      sessionId: this.id,
      type: slot.type,
      index: slot.index,
      status: slot.status,
      attempts: slot.attempts,
      maxAttempts: slot.settings.maxAttempts,
      timeoutMs: slot.settings.timeoutMs,
      progress: slot.progress,
      startedAt: slot.startedAt,
      attemptStartedAt: slot.attemptStartedAt,
      endedAt: slot.endedAt,
      failureReason: slot.failureReason,
      evidence: slot.evidence,
    };
  }
}

function resolveSettings(
  settings: ChallengeSettings,
  defaults: Readonly<Required<ChallengeSettings>>,
): Readonly<Required<ChallengeSettings>> {
  const resolved = {
    timeoutMs: settings.timeoutMs ?? defaults.timeoutMs,
    maxAttempts: settings.maxAttempts ?? defaults.maxAttempts,
    maxFaceLostMs: settings.maxFaceLostMs ?? defaults.maxFaceLostMs,
  };
  if (!(resolved.timeoutMs > 0)) throw new RangeError("ChallengeManager: timeoutMs must be positive.");
  if (!(Number.isInteger(resolved.maxAttempts) && resolved.maxAttempts >= 1)) {
    throw new RangeError("ChallengeManager: maxAttempts must be an integer >= 1.");
  }
  if (!(resolved.maxFaceLostMs > 0)) throw new RangeError("ChallengeManager: maxFaceLostMs must be positive.");
  return resolved;
}

let fallbackCounter = 0;

function defaultSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `session-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
