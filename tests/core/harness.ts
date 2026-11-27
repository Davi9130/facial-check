import { vi } from "vitest";
import { CameraManager } from "../../src/camera/CameraManager";
import { FacialCheck } from "../../src/core/FacialCheck";
import type { FaceEngine } from "../../src/engines/FaceEngine";
import type { FaceAnalysis } from "../../src/types/analysis.types";
import type { FaceDetectionResult } from "../../src/types/face.types";
import type { FacialCheckConfig, FacialCheckEvents, FrameAnalyzer, FrameScheduler } from "../../src/types/session.types";
import { FakeStream, asStream, createVideo } from "../camera/mocks";
import { FRAME_MS, frame, type Pose } from "../challenges/frames";

/** Frame scheduler driven by the test. */
export class ManualScheduler implements FrameScheduler {
  private next = 1;
  readonly queue = new Map<number, () => void>();
  request(callback: () => void): number {
    const handle = this.next++;
    this.queue.set(handle, callback);
    return handle;
  }
  cancel(handle: unknown): void {
    this.queue.delete(handle as number);
  }
  /** Runs the callbacks queued so far. */
  run(): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const cb of callbacks) cb();
  }
}

const FACE: FaceDetectionResult = {
  box: { x: 0.3, y: 0.25, width: 0.4, height: 0.5 },
  score: 0.95,
  imageSize: { width: 640, height: 480 },
};

/**
 * Mocked camera scene: each processed frame consumes the next pose; `null`
 * (or an empty script) means no face in front of the camera.
 */
export class Scene {
  private poses: (Pose | null)[] = [];
  current: Pose | null = null;
  push(poses: readonly (Pose | null)[]): void {
    this.poses.push(...poses);
  }
  shift(): Pose | null {
    this.current = this.poses.length > 0 ? (this.poses.shift() ?? null) : null;
    return this.current;
  }
  get remaining(): number {
    return this.poses.length;
  }
}

/** Mocked engine: one face when the scene pose is not `null`. */
export function createEngine(scene: Scene, name = "mock-engine") {
  let loaded = false;
  const engine = {
    name,
    get isLoaded() {
      return loaded;
    },
    load: vi.fn(async () => {
      loaded = true;
    }),
    detect: vi.fn(async (): Promise<FaceDetectionResult[]> => (scene.shift() === null ? [] : [FACE])),
    dispose: vi.fn(() => {
      loaded = false;
    }),
  } satisfies FaceEngine;
  return engine;
}

/** Analyzer that turns the scene pose into the synthetic analyses used by the challenge tests. */
export function createAnalyzer(scene: Scene): FrameAnalyzer {
  return {
    analyze: (faces, ts): FaceAnalysis => (faces.length > 0 && scene.current ? frame(scene.current, ts) : noFace(ts)),
    reset: vi.fn(),
  };
}

function noFace(timestamp: number): FaceAnalysis {
  return {
    timestamp,
    faceDetected: false,
    faceCount: 0,
    score: null,
    position: null,
    size: null,
    eyes: null,
    mouth: null,
    headPose: null,
    stability: { stable: false, frames: 0, movement: 0, sizeChange: 0, jumped: false },
    issues: ["no-face"],
    ready: false,
  };
}

const EVENTS = [
  "faceDetected",
  "challengeStarted",
  "challengeCompleted",
  "challengeFailed",
  "progress",
  "completed",
  "error",
  "statusChange",
] as const satisfies readonly (keyof FacialCheckEvents)[];

/** Builds a `FacialCheck` wired to a mocked camera, engine and analyzer. */
export function setup(config: FacialCheckConfig = {}) {
  const scene = new Scene();
  const scheduler = new ManualScheduler();
  let clock = 1_000_000;
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => asStream(stream));
  const camera = new CameraManager({ mediaDevices: { getUserMedia } as unknown as MediaDevices });
  const engine = createEngine(scene);
  const analyzer = createAnalyzer(scene);
  const video = createVideo();
  let ids = 0;

  const facialCheck = new FacialCheck({
    engine,
    camera,
    analyzer,
    video,
    scheduler,
    randomChallenges: false,
    maxFps: 1000,
    now: () => clock,
    createSessionId: () => `session-${++ids}`,
    ...config,
  });

  const log: { name: keyof FacialCheckEvents; payload: unknown }[] = [];
  for (const name of EVENTS) facialCheck.on(name, (payload) => log.push({ name, payload }));
  const of = <K extends keyof FacialCheckEvents>(name: K) =>
    log.filter((e) => e.name === name).map((e) => e.payload as FacialCheckEvents[K]);

  /** Processes `n` frames, one every `FRAME_MS`. */
  async function frames(n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      clock += FRAME_MS;
      scheduler.run();
      await flush();
    }
  }

  /** Pushes `poses` and processes exactly that many frames. */
  async function play(poses: readonly (Pose | null)[]): Promise<void> {
    scene.push(poses);
    await frames(poses.length);
  }

  return {
    facialCheck,
    scene,
    scheduler,
    camera,
    stream,
    getUserMedia,
    engine,
    analyzer,
    video,
    log,
    of,
    frames,
    play,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
