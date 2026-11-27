import { ChallengeManager } from "../challenges/ChallengeManager";
import type { FaceEngine } from "../engines/FaceEngine";
import type {
  FacialCheckConfig,
  FacialCheckEvents,
  FacialCheckResult,
  FacialCheckStatus,
  FrameAnalyzer,
  FrameScheduler,
  SessionCamera,
  SessionPad,
} from "../types/session.types";
import { EventEmitter, type Listener } from "./EventEmitter";
import {
  createAnalyzer,
  createCamera,
  createEngine,
  defaultScheduler,
  resolveFacialCheckConfig,
  type ResolvedFacialCheckConfig,
} from "./FacialCheckConfig";
import { FacialCheckError } from "./FacialCheckError";
import { FacialSession } from "./FacialSession";

/** Events a `FacialSession` emits that `FacialCheck` forwards as-is. */
const FORWARDED = [
  "faceDetected",
  "frame",
  "challengeStarted",
  "challengeCompleted",
  "challengeFailed",
  "progress",
  "completed",
  "error",
] as const satisfies readonly (keyof FacialCheckEvents)[];

const ACTIVE: ReadonlySet<FacialCheckStatus> = new Set(["starting", "waiting-face", "running", "analyzing-pad"]);

/**
 * Programmatic, framework-agnostic Face Liveness API.
 *
 * ```ts
 * const facialCheck = new FacialCheck({ challenges: ["blink", "open-mouth", "turn-left", "turn-right"], randomChallenges: true });
 * facialCheck.on("challengeStarted", ({ challenge }) => showInstruction(challenge.type));
 * facialCheck.on("completed", (result) => console.info(result.challenges.passed, result.pad?.status));
 * await facialCheck.initialize(); // loads the engine models
 * await facialCheck.start();      // opens the camera and runs a session
 * // …
 * facialCheck.destroy();          // releases camera and engine
 * ```
 *
 * Each `start()` runs a new {@link FacialSession}. Everything runs locally:
 * frames are not uploaded, stored or logged (a configured PAD provider gets a
 * few in-memory frames at the end of the session).
 */
export class FacialCheck {
  private readonly events = new EventEmitter<FacialCheckEvents>();
  private readonly config: ResolvedFacialCheckConfig;
  private readonly engine: FaceEngine;
  private readonly camera: SessionCamera;
  private readonly analyzer: FrameAnalyzer;
  private readonly challenges: ChallengeManager;
  private readonly scheduler: FrameScheduler;
  private readonly padDetector: SessionPad | undefined;

  private video: HTMLVideoElement | null;
  private status: FacialCheckStatus = "idle";
  private loading: Promise<void> | null = null;
  private session: FacialSession | null = null;

  /** @throws {FacialCheckError} `INVALID_CONFIG` */
  constructor(config: FacialCheckConfig = {}) {
    this.config = resolveFacialCheckConfig(config);
    try {
      this.challenges = new ChallengeManager({ ...this.config.challengeOptions, now: this.config.now });
    } catch (error) {
      throw new FacialCheckError("INVALID_CONFIG", `FacialCheck: ${(error as Error).message}`, { cause: error });
    }
    this.engine = createEngine(config);
    this.camera = createCamera(config);
    this.analyzer = createAnalyzer(config);
    this.scheduler = config.scheduler ?? defaultScheduler();
    this.padDetector = config.padDetector;
    this.video = config.video ?? null;
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

  /** Name of the selected engine (`"face-api"`, `"mediapipe"`, …). */
  get engineName(): string {
    return this.engine.name;
  }

  /** Id of the current (or last) session; empty before the first `start()`. */
  get sessionId(): string {
    return this.session?.id ?? "";
  }

  /**
   * Uses `video` to show the camera (and to read frames). Can be called at
   * any time; a running session switches to it.
   */
  attachVideo(video: HTMLVideoElement): void {
    this.assertAlive();
    this.video = video;
    if (this.session && !this.session.isEnded) void this.camera.attach(video).catch(() => undefined);
  }

  /**
   * Loads the engine (models). Concurrent calls share the same load; calls
   * once loaded resolve right away.
   *
   * @throws {FacialCheckError} `ENGINE_ERROR`, `DESTROYED`
   */
  initialize(): Promise<void> {
    if (this.status === "destroyed") return Promise.reject(destroyedError());
    if (this.engine.isLoaded) {
      if (this.status === "idle") this.setStatus("ready");
      return Promise.resolve();
    }
    if (this.loading) return this.loading;
    this.setStatus("initializing");
    const loading = this.engine
      .load()
      .then(
        () => {
          if (this.status === "destroyed") {
            this.engine.dispose();
            throw new FacialCheckError("DESTROYED", "FacialCheck: destroyed while initializing.");
          }
          if (this.status === "initializing") this.setStatus("ready");
        },
        (cause: unknown) => {
          if (this.status === "destroyed") {
            throw new FacialCheckError("DESTROYED", "FacialCheck: destroyed while initializing.");
          }
          const error = new FacialCheckError("ENGINE_ERROR", "FacialCheck: the face engine could not be loaded.", { cause });
          if (this.status === "initializing") this.setStatus("idle");
          this.events.emit("error", { sessionId: "", error, fatal: true });
          throw error;
        },
      )
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });
    this.loading = loading;
    return loading;
  }

  /**
   * Starts a new session (calling `initialize()` first if needed): opens the
   * camera and runs the challenges. Resolves once the session is running;
   * its end is reported by the `completed` event. No-op while a session runs.
   *
   * @throws {FacialCheckError} `ENGINE_ERROR`, `CAMERA_ERROR`, `DESTROYED`
   */
  async start(): Promise<void> {
    this.assertAlive();
    if (ACTIVE.has(this.status)) return;
    await this.initialize();
    this.assertAlive();
    if (ACTIVE.has(this.status)) return; // another start() won the race.

    const session = new FacialSession({
      camera: this.camera,
      engine: this.engine,
      analyzer: this.analyzer,
      challenges: this.challenges,
      video: this.resolveVideo(),
      scheduler: this.scheduler,
      config: this.config,
      padDetector: this.padDetector,
    });
    this.session = session;
    session.on("statusChange", ({ status }) => {
      if (this.session === session && this.status !== "destroyed") this.setStatus(status);
    });
    const forward = <K extends keyof FacialCheckEvents>(name: K): void => {
      session.on(name, (payload) => this.events.emit(name, payload));
    };
    for (const name of FORWARDED) forward(name);
    await session.start();
  }

  /** Stops the running session (status `stopped`) and releases the camera. The engine stays loaded. */
  stop(): void {
    this.session?.stop();
  }

  /**
   * Stops any session and releases the camera, the engine and every
   * listener. The instance cannot be used afterwards. Safe to call twice.
   */
  destroy(): void {
    if (this.status === "destroyed") return;
    this.session?.stop();
    this.setStatus("destroyed");
    this.challenges.destroy();
    try {
      this.camera.stop();
    } finally {
      this.engine.dispose();
      this.events.removeAllListeners();
    }
  }

  getStatus(): FacialCheckStatus {
    return this.status;
  }

  /**
   * Result of the current or last session. The presence challenges
   * (`challenges`) and the PAD verdict (`pad`) are reported separately.
   */
  getResults(): FacialCheckResult {
    if (this.session) return { ...this.session.getResult(), status: this.status };
    return {
      sessionId: "",
      status: this.status,
      engine: this.engine.name,
      startedAt: null,
      challengesStartedAt: null,
      endedAt: null,
      durationMs: null,
      challenges: { sessionId: "", status: "idle", passed: false, startedAt: null, endedAt: null, challenges: [] },
      pad: null,
      error: null,
    };
  }

  private resolveVideo(): HTMLVideoElement {
    if (this.video) return this.video;
    if (typeof document === "undefined") {
      throw new FacialCheckError("CAMERA_ERROR", "FacialCheck: no <video> available; pass `video` or call attachVideo().");
    }
    this.video = document.createElement("video");
    return this.video;
  }

  private assertAlive(): void {
    if (this.status === "destroyed") throw destroyedError();
  }

  private setStatus(status: FacialCheckStatus): void {
    const previous = this.status;
    if (previous === status) return;
    this.status = status;
    this.events.emit("statusChange", { status, previous });
  }
}

function destroyedError(): FacialCheckError {
  return new FacialCheckError("DESTROYED", "FacialCheck: this instance was destroyed.");
}
