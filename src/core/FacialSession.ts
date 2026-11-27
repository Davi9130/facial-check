import type { ChallengeManager } from "../challenges/ChallengeManager";
import type { FaceEngine } from "../engines/FaceEngine";
import type { PadAnalysis } from "../pad/PadResult";
import type { PadFrame } from "../pad/PadProvider";
import type { FaceDetectionResult } from "../types/face.types";
import type { ChallengeSessionResult } from "../types/challenge.types";
import type {
  FacialCheckErrorCode,
  FacialCheckErrorInfo,
  FacialCheckEvents,
  FacialCheckResult,
  FacialSessionStatus,
  FrameAnalyzer,
  FrameScheduler,
  SessionCamera,
  SessionPad,
} from "../types/session.types";
import { EventEmitter, type Listener } from "./EventEmitter";
import { FacialCheckError } from "./FacialCheckError";
import type { ResolvedFacialCheckConfig } from "./FacialCheckConfig";

/** Everything a session orchestrates. The session owns none of it except the frame loop. */
export interface FacialSessionDeps {
  readonly camera: SessionCamera;
  /** Must be loaded already. */
  readonly engine: FaceEngine;
  readonly analyzer: FrameAnalyzer;
  readonly challenges: ChallengeManager;
  readonly video: HTMLVideoElement;
  readonly scheduler: FrameScheduler;
  readonly config: ResolvedFacialCheckConfig;
  readonly padDetector?: SessionPad | undefined;
  /** Session id. Default: generated. */
  readonly id?: string;
}

const LOOPING: ReadonlySet<FacialSessionStatus> = new Set(["waiting-face", "running"]);
const ENDED: ReadonlySet<FacialSessionStatus> = new Set(["completed", "failed", "stopped", "error"]);

/**
 * One liveness session: opens the camera, then runs a frame loop
 * camera → engine → analyzer → `ChallengeManager`, and, once the challenges
 * end, the optional PAD on a few frames captured during the session.
 *
 * The challenges start on the first frame with a face. The session ends as
 * `completed` (every challenge done), `failed` (a challenge failed),
 * `stopped` (`stop()`) or `error` (camera lost, engine failing). The camera
 * is released as soon as the session ends; captured PAD frames are kept in
 * memory only until the PAD answers.
 *
 * Usually created by `FacialCheck`; usable alone with injected dependencies.
 */
export class FacialSession {
  readonly id: string;
  /** Resolves with the final result once the session ended, whatever the reason. Never rejects. */
  readonly finished: Promise<FacialCheckResult>;

  private readonly events = new EventEmitter<FacialCheckEvents>();
  private readonly deps: FacialSessionDeps;
  private readonly now: () => number;
  private readonly minFrameIntervalMs: number;
  private resolveFinished: (result: FacialCheckResult) => void = () => undefined;
  private unsubscribe: (() => void)[] = [];

  private status: FacialSessionStatus | "created" = "created";
  private startedAt: number | null = null;
  private challengesStartedAt: number | null = null;
  private endedAt: number | null = null;
  private challengeResult: ChallengeSessionResult | null = null;
  private padAnalysis: PadAnalysis | null = null;
  private errorInfo: FacialCheckErrorInfo | null = null;

  private frameHandle: unknown = null;
  private framePending = false;
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  private detectionErrors = 0;
  private faceVisible = false;
  private padFrames: PadFrame[] = [];
  private padAbort: AbortController | null = null;

  constructor(deps: FacialSessionDeps) {
    this.deps = deps;
    this.now = deps.config.now;
    this.minFrameIntervalMs = 1000 / deps.config.maxFps;
    this.id = deps.id ?? deps.config.createSessionId?.() ?? defaultSessionId();
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
  }

  on<K extends keyof FacialCheckEvents>(event: K, listener: Listener<FacialCheckEvents[K]>): () => void {
    return this.events.on(event, listener);
  }

  once<K extends keyof FacialCheckEvents>(event: K, listener: Listener<FacialCheckEvents[K]>): () => void {
    return this.events.once(event, listener);
  }

  off<K extends keyof FacialCheckEvents>(event: K, listener: Listener<FacialCheckEvents[K]>): void {
    this.events.off(event, listener);
  }

  getStatus(): FacialSessionStatus | "created" {
    return this.status;
  }

  get isEnded(): boolean {
    return this.status !== "created" && ENDED.has(this.status);
  }

  /**
   * Opens the camera and starts the frame loop. Resolves once frames are
   * being processed (not when the session ends: see `finished`).
   *
   * @throws {FacialCheckError} `CAMERA_ERROR` (the session ends as `error`),
   *   `INVALID_STATE` when called twice.
   */
  async start(): Promise<void> {
    if (this.status !== "created") throw new FacialCheckError("INVALID_STATE", "FacialSession: already started.");
    this.startedAt = this.now();
    this.setStatus("starting");
    const { camera, video } = this.deps;
    try {
      await camera.attach(video);
      await camera.start();
    } catch (error) {
      const failure = new FacialCheckError("CAMERA_ERROR", "FacialSession: could not open the camera.", { cause: error });
      if (!this.isEnded) this.fail(failure);
      throw failure;
    }
    if (this.isEnded) return; // stop() while the camera was opening.
    this.subscribeChallenges();
    this.deps.analyzer.reset();
    this.setStatus("waiting-face");
    this.scheduleFrame();
  }

  /** Ends the session as `stopped` and releases the camera. No-op once ended. */
  stop(): void {
    if (this.isEnded) return;
    if (this.status === "created") this.startedAt = this.now();
    this.end("stopped");
  }

  /** Current result (final once `isEnded`). */
  getResult(): FacialCheckResult {
    const challenges = this.challengeResult ?? this.deps.challenges.getResult();
    return {
      sessionId: this.id,
      status: this.status === "created" ? "starting" : this.status,
      engine: this.deps.engine.name,
      startedAt: this.startedAt,
      challengesStartedAt: this.challengesStartedAt,
      endedAt: this.endedAt,
      durationMs: this.startedAt !== null && this.endedAt !== null ? this.endedAt - this.startedAt : null,
      challenges: this.challengesStartedAt === null ? { ...challenges, sessionId: this.id, status: "idle", passed: false, challenges: [] } : challenges,
      pad: this.padAnalysis,
      error: this.errorInfo,
    };
  }

  // ------------------------------------------------------------------ frame loop

  private scheduleFrame(): void {
    if (this.frameHandle !== null || !this.isLooping()) return;
    this.frameHandle = this.deps.scheduler.request(this.onFrame);
  }

  private readonly onFrame = (): void => {
    this.frameHandle = null;
    if (!this.isLooping() || this.framePending) return;
    const ts = this.now();
    if (ts - this.lastFrameAt < this.minFrameIntervalMs) {
      this.scheduleFrame();
      return;
    }
    this.lastFrameAt = ts;
    this.framePending = true;
    void this.processFrame(ts).finally(() => {
      this.framePending = false;
      this.scheduleFrame();
    });
  };

  private async processFrame(ts: number): Promise<void> {
    const { camera, engine, video, analyzer, challenges } = this.deps;
    if (!camera.isActive) {
      this.fail(new FacialCheckError("CAMERA_ERROR", "FacialSession: the camera stopped unexpectedly."));
      return;
    }

    let faces: FaceDetectionResult[] | null;
    try {
      faces = await engine.detect(video);
      this.detectionErrors = 0;
    } catch (error) {
      faces = null;
      this.detectionErrors += 1;
      if (this.detectionErrors >= this.deps.config.maxDetectionErrors) {
        if (this.isLooping()) {
          this.fail(new FacialCheckError("ENGINE_ERROR", "FacialSession: face detection keeps failing.", { cause: error }));
        }
        return;
      }
    }
    if (!this.isLooping()) return; // stopped while detecting.

    if (faces === null) {
      // Transient detection failure: no frame, but time still runs for the challenge.
      if (this.status === "running") challenges.tick(ts);
      return;
    }

    const analysis = analyzer.analyze(faces, ts);
    this.events.emit("frame", analysis);
    if (analysis.faceDetected !== this.faceVisible) {
      this.faceVisible = analysis.faceDetected;
      this.events.emit("faceDetected", {
        sessionId: this.id,
        detected: analysis.faceDetected,
        timestamp: ts,
        faceCount: analysis.faceCount,
        ready: analysis.ready,
        issues: analysis.issues,
      });
    }
    if (!this.isLooping()) return; // a listener stopped the session.

    if (this.status === "waiting-face") {
      if (!analysis.faceDetected) return;
      this.challengesStartedAt = ts;
      this.setStatus("running");
      challenges.start({ sessionId: this.id, timestamp: ts });
    }
    challenges.update(analysis, ts);
  }

  // ------------------------------------------------------------------ challenges / PAD

  private subscribeChallenges(): void {
    const c = this.deps.challenges;
    this.unsubscribe = [
      c.on("challengeStarted", (e) => this.events.emit("challengeStarted", e)),
      c.on("challengeCompleted", (e) => {
        this.capturePadFrame();
        this.events.emit("challengeCompleted", e);
      }),
      c.on("challengeFailed", (e) => this.events.emit("challengeFailed", e)),
      c.on("progress", (e) => this.events.emit("progress", e)),
      c.on("finished", (result) => {
        if (result.status !== "stopped") void this.onChallengesFinished(result);
      }),
    ];
  }

  private capturePadFrame(): void {
    if (!this.deps.padDetector || this.padFrames.length >= this.deps.config.padMaxFrames) return;
    try {
      this.padFrames.push({ image: this.deps.camera.captureFrame(), timestamp: this.now() });
    } catch {
      // No frame available (e.g. video not ready): the PAD gets fewer frames.
    }
  }

  private async onChallengesFinished(result: ChallengeSessionResult): Promise<void> {
    if (!this.isLooping()) return;
    this.challengeResult = result;
    const outcome = result.passed ? "completed" : "failed";
    const pad = this.deps.padDetector;
    if (!pad) {
      this.end(outcome);
      return;
    }

    this.cancelFrame();
    this.releaseCamera();
    this.setStatus("analyzing-pad");
    const abort = new AbortController();
    this.padAbort = abort;
    const frames = this.padFrames;
    this.padFrames = [];
    try {
      const timeoutMs = this.deps.config.padTimeoutMs;
      const analysis = await pad.analyze(
        { frames },
        timeoutMs === undefined ? { signal: abort.signal } : { signal: abort.signal, timeoutMs },
      );
      if (this.status !== "analyzing-pad") return; // stopped meanwhile.
      this.padAnalysis = analysis;
    } catch (error) {
      if (this.status !== "analyzing-pad") return;
      this.emitError(new FacialCheckError("PAD_ERROR", "FacialSession: the PAD analysis failed.", { cause: error }), false);
    } finally {
      frames.length = 0;
      if (this.padAbort === abort) this.padAbort = null;
    }
    this.end(outcome);
  }

  // ------------------------------------------------------------------ ending

  private fail(error: FacialCheckError): void {
    this.errorInfo = error.toJSON();
    this.end("error");
    this.emitError(error, true);
  }

  private emitError(error: FacialCheckError & { code: FacialCheckErrorCode }, fatal: boolean): void {
    this.events.emit("error", { sessionId: this.id, error, fatal });
  }

  private end(status: Extract<FacialSessionStatus, "completed" | "failed" | "stopped" | "error">): void {
    this.cancelFrame();
    this.padAbort?.abort();
    this.padAbort = null;
    this.padFrames = [];
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    if (this.deps.challenges.getStatus() === "running") {
      this.deps.challenges.stop(this.now());
    }
    if (this.challengesStartedAt !== null && this.challengeResult === null) {
      this.challengeResult = this.deps.challenges.getResult();
    }
    this.releaseCamera();
    this.endedAt = this.now();
    this.setStatus(status);
    const result = this.getResult();
    if (status === "completed" || status === "failed") this.events.emit("completed", result);
    this.resolveFinished(result);
  }

  private releaseCamera(): void {
    try {
      this.deps.camera.stop();
    } catch {
      // Releasing must never throw.
    }
  }

  private cancelFrame(): void {
    if (this.frameHandle === null) return;
    this.deps.scheduler.cancel(this.frameHandle);
    this.frameHandle = null;
  }

  private isLooping(): boolean {
    return this.status !== "created" && LOOPING.has(this.status);
  }

  private setStatus(status: FacialSessionStatus): void {
    const previous = this.status;
    if (previous === status) return;
    this.status = status;
    this.events.emit("statusChange", { status, previous: previous === "created" ? "ready" : previous });
  }
}

let fallbackCounter = 0;

function defaultSessionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `session-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
