import { useMemo } from "react";
import { createAnalyzer, createEngine, defaultScheduler } from "../../core/FacialCheckConfig";
import type { FaceApiEngineOptions } from "../../engines/FaceApiEngine";
import type { FaceEngine } from "../../engines/FaceEngine";
import type { MediaPipeEngineOptions } from "../../engines/MediaPipeEngine";
import type { FaceAnalysis, FaceAnalyzerOptions } from "../../types/analysis.types";
import type { FaceDetectionResult, FaceEngineInput } from "../../types/face.types";
import type { FacialCheckEngineName, FrameAnalyzer, FrameScheduler } from "../../types/session.types";
import { HookStore } from "./HookStore";
import { useHookStore } from "./useHookStore";

/**
 * Options of `useFaceDetection`. Engine and analyzer options are read once,
 * when the hook creates them (after mount); `video`, `enabled` and callbacks
 * can change on every render.
 */
export interface UseFaceDetectionOptions {
  /** `"face-api"` (default), `"mediapipe"` or a `FaceEngine` (not disposed by the hook). */
  engine?: FacialCheckEngineName | FaceEngine;
  faceApi?: FaceApiEngineOptions;
  mediapipe?: MediaPipeEngineOptions;
  /** `FaceAnalyzer` options, or a custom analyzer. */
  analyzer?: FaceAnalyzerOptions | FrameAnalyzer;
  /**
   * Frame source, e.g. `useFaceCamera().video`. When omitted, the element
   * attached through `videoRef` is used.
   */
  video?: FaceEngineInput | null;
  /** Run the detection loop (once the engine is loaded). Default: `true`. */
  enabled?: boolean;
  /** Upper bound of processed frames per second. Default: `15`. */
  maxFps?: number;
  /** Consecutive failed detections before the loop stops with `error`. Default: `5`. */
  maxDetectionErrors?: number;
  /** Clock (ms). Default: `performance.now` / `Date.now`. */
  now?: () => number;
  scheduler?: FrameScheduler;
  /** Every processed frame. */
  onResult?: (analysis: FaceAnalysis, faces: readonly FaceDetectionResult[]) => void;
  onError?: (error: Error) => void;
}

/**
 * - `idle`: not mounted yet;
 * - `loading`: loading the models;
 * - `ready`: loaded, loop not running (disabled or stopped);
 * - `detecting`: loop running;
 * - `error`: the models could not load, or detection kept failing.
 */
export type FaceDetectionStatus = "idle" | "loading" | "ready" | "detecting" | "error";

export interface FaceDetectionState {
  status: FaceDetectionStatus;
  /** Faces of the last processed frame, highest score first. */
  faces: readonly FaceDetectionResult[];
  /** Analysis of the last processed frame, or `null`. */
  analysis: FaceAnalysis | null;
  faceDetected: boolean;
  error: Error | null;
  /** The engine in use, `null` until the component is mounted. */
  engine: FaceEngine | null;
}

export interface UseFaceDetectionResult extends FaceDetectionState {
  /** Frame source when no `video` option is given: `<video ref={videoRef} />`. */
  videoRef: (video: HTMLVideoElement | null) => void;
  /** Runs the detection loop (after the models load). */
  start: () => void;
  /** Pauses the detection loop. The models stay loaded. */
  stop: () => void;
}

const INITIAL: FaceDetectionState = {
  status: "idle",
  faces: [],
  analysis: null,
  faceDetected: false,
  error: null,
  engine: null,
};

const DEFAULT_MAX_FPS = 15;
const DEFAULT_MAX_ERRORS = 5;

export class FaceDetectionStore extends HookStore<FaceDetectionState, UseFaceDetectionOptions> {
  private engine: FaceEngine | null = null;
  private ownsEngine = false;
  private analyzer: FrameAnalyzer | null = null;
  private scheduler: FrameScheduler = defaultScheduler();
  private refVideo: HTMLVideoElement | null = null;
  private running = false;
  private loaded = false;
  /** Bumped on release so late promises know they are stale. */
  private generation = 0;
  private handle: unknown = null;
  private pending = false;
  private lastFrameAt = -Infinity;
  private errors = 0;

  constructor(options: UseFaceDetectionOptions) {
    super(options, INITIAL);
  }

  readonly videoRef = (video: HTMLVideoElement | null): void => {
    this.refVideo = video;
  };

  readonly start = (): void => {
    if (!this.ensureAcquired()) return;
    this.running = true;
    if (!this.loaded) return; // starts once loaded.
    this.errors = 0;
    this.setState({ status: "detecting", error: null });
    this.schedule();
  };

  readonly stop = (): void => {
    this.running = false;
    this.cancel();
    if (this.loaded) this.setState({ status: "ready" });
  };

  protected acquire(): void {
    const options = this.options;
    const generation = ++this.generation;
    const external = typeof options.engine === "object" ? options.engine : undefined;
    let engine: FaceEngine;
    let analyzer: FrameAnalyzer;
    try {
      engine = external ?? createEngine(pick(options, ["engine", "faceApi", "mediapipe"]));
      analyzer = createAnalyzer(pick(options, ["analyzer"]));
    } catch (error) {
      this.fail(error);
      return;
    }
    this.engine = engine;
    const owned = external === undefined;
    this.ownsEngine = owned;
    this.analyzer = analyzer;
    this.scheduler = options.scheduler ?? defaultScheduler();
    this.running = options.enabled ?? true;
    this.loaded = false;
    this.errors = 0;
    this.lastFrameAt = -Infinity;
    this.setState({ ...INITIAL, status: "loading", engine });

    engine.load().then(
      () => {
        if (generation !== this.generation) {
          if (owned) engine.dispose();
          return;
        }
        this.loaded = true;
        this.setState({ status: "ready" });
        if (this.running) this.start();
      },
      (error: unknown) => {
        if (generation === this.generation) this.fail(error);
      },
    );
  }

  protected release(): void {
    this.generation += 1;
    this.running = false;
    this.cancel();
    const engine = this.engine;
    if (engine && this.ownsEngine) engine.dispose();
    this.analyzer?.reset();
    this.engine = null;
    this.analyzer = null;
    this.loaded = false;
    this.setState({ ...INITIAL });
  }

  protected override optionsChanged(previous: UseFaceDetectionOptions): void {
    const enabled = this.options.enabled ?? true;
    if (enabled === (previous.enabled ?? true)) return;
    if (enabled) this.start();
    else this.stop();
  }

  private now(): number {
    if (this.options.now) return this.options.now();
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  private schedule(): void {
    if (this.handle !== null || !this.running || !this.loaded) return;
    this.handle = this.scheduler.request(this.onFrame);
  }

  private cancel(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  private readonly onFrame = (): void => {
    this.handle = null;
    if (!this.running || this.pending) return;
    const video = this.options.video ?? this.refVideo;
    const ts = this.now();
    const interval = 1000 / (this.options.maxFps ?? DEFAULT_MAX_FPS);
    if (!video || ts - this.lastFrameAt < interval) {
      this.schedule();
      return;
    }
    this.lastFrameAt = ts;
    this.pending = true;
    const generation = this.generation;
    void this.process(video, ts, generation).finally(() => {
      this.pending = false;
      if (generation === this.generation) this.schedule();
    });
  };

  private async process(video: FaceEngineInput, ts: number, generation: number): Promise<void> {
    const engine = this.engine;
    const analyzer = this.analyzer;
    if (!engine || !analyzer) return;
    let faces: FaceDetectionResult[];
    try {
      faces = await engine.detect(video);
    } catch (error) {
      if (generation !== this.generation || !this.running) return;
      this.errors += 1;
      if (this.errors >= (this.options.maxDetectionErrors ?? DEFAULT_MAX_ERRORS)) {
        this.running = false;
        this.fail(error);
      }
      return;
    }
    if (generation !== this.generation || !this.running) return;
    this.errors = 0;
    const analysis = analyzer.analyze(faces, ts);
    this.setState({ faces, analysis, faceDetected: analysis.faceDetected });
    this.options.onResult?.(analysis, faces);
  }

  private fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error("Face detection failed.", { cause });
    this.setState({ status: "error", error });
    this.options.onError?.(error);
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out as Pick<T, K>;
}

/**
 * Real-time face detection on a `<video>` (or any frame source): loads an
 * engine, runs it at most `maxFps` times per second and analyzes every frame
 * with `FaceAnalyzer`.
 *
 * ```tsx
 * const camera = useFaceCamera({ autoStart: true });
 * const { faceDetected, analysis } = useFaceDetection({ video: camera.video });
 * return <video ref={camera.videoRef} />;
 * ```
 *
 * The loop stops and the engine is disposed on unmount (unless an engine
 * instance was given). Frames are processed in memory only.
 */
export function useFaceDetection(options: UseFaceDetectionOptions = {}): UseFaceDetectionResult {
  const [store, state] = useHookStore((o: UseFaceDetectionOptions) => new FaceDetectionStore(o), options);
  return useMemo(
    () => ({ ...state, videoRef: store.videoRef, start: store.start, stop: store.stop }),
    [state, store],
  );
}
