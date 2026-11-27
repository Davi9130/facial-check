import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceEngineError, type FaceEngine } from "../../src/engines/FaceEngine";
import { headPoseFromMatrix, MEDIAPIPE_TO_68, MediaPipeEngine } from "../../src/engines/MediaPipeEngine";

interface FakeResult {
  faceLandmarks: { x: number; y: number; z: number; visibility: number }[][];
  faceBlendshapes: { categories: { categoryName: string; score: number; index: number; displayName: string }[] }[];
  facialTransformationMatrixes: { rows: number; columns: number; data: number[] }[];
}

const state = vi.hoisted(() => ({
  result: null as FakeResult | null,
  filesetError: null as Error | null,
  createErrors: {} as Record<string, Error | undefined>,
  detectError: null as Error | null,
  filesetPaths: [] as string[],
  createOptions: [] as Record<string, unknown>[],
  detectCalls: [] as { input: unknown; timestamp: number }[],
  closed: 0,
}));

vi.mock("@mediapipe/tasks-vision", () => {
  class FaceLandmarker {
    static async createFromOptions(_fileset: unknown, options: { baseOptions: { delegate: string } }) {
      state.createOptions.push(options as unknown as Record<string, unknown>);
      const error = state.createErrors[options.baseOptions.delegate];
      if (error) throw error;
      return new FaceLandmarker();
    }
    detectForVideo(input: unknown, timestamp: number) {
      state.detectCalls.push({ input, timestamp });
      if (state.detectError) throw state.detectError;
      return state.result ?? { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
    }
    close() {
      state.closed += 1;
    }
  }
  const FilesetResolver = {
    async forVisionTasks(basePath: string) {
      state.filesetPaths.push(basePath);
      if (state.filesetError) throw state.filesetError;
      return { wasmLoaderPath: `${basePath}/x.js`, wasmBinaryPath: `${basePath}/x.wasm` };
    },
  };
  return { FaceLandmarker, FilesetResolver };
});

/** 478-point mesh: point i at (0.2 + (i % 10) * 0.05, 0.1 + floor(i / 50) * 0.08, i / 1000). */
function mesh(count = 478) {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.2 + (i % 10) * 0.05,
    y: 0.1 + Math.floor(i / 50) * 0.08,
    z: i / 1000,
    visibility: 0,
  }));
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1];

function face(overrides: Partial<FakeResult> = {}): FakeResult {
  return {
    faceLandmarks: [mesh()],
    faceBlendshapes: [
      {
        categories: [
          { categoryName: "_neutral", score: 0.1, index: 0, displayName: "" },
          { categoryName: "eyeBlinkLeft", score: 0.8, index: 9, displayName: "" },
          { categoryName: "jawOpen", score: 0.3, index: 25, displayName: "" },
        ],
      },
    ],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: IDENTITY }],
    ...overrides,
  };
}

function canvas(width = 640, height = 480): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
}

function video(currentTime = 0, readyState = 4): HTMLVideoElement {
  const el = document.createElement("video");
  Object.defineProperty(el, "readyState", { configurable: true, value: readyState });
  Object.defineProperty(el, "videoWidth", { configurable: true, value: 640 });
  Object.defineProperty(el, "videoHeight", { configurable: true, value: 480 });
  Object.defineProperty(el, "currentTime", { configurable: true, writable: true, value: currentTime });
  return el;
}

let now = 1000;

beforeEach(() => {
  state.result = null;
  state.filesetError = null;
  state.createErrors = {};
  state.detectError = null;
  state.filesetPaths = [];
  state.createOptions = [];
  state.detectCalls = [];
  state.closed = 0;
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaPipeEngine options", () => {
  it("implements the FaceEngine contract", () => {
    const engine: FaceEngine = new MediaPipeEngine();
    expect(engine.name).toBe("mediapipe");
    expect(engine.isLoaded).toBe(false);
  });

  it.each([
    [{ maxFaces: 0 }, /maxFaces/],
    [{ maxFaces: 1.5 }, /maxFaces/],
    [{ maxFps: 0 }, /maxFps/],
    [{ maxFps: Number.NaN }, /maxFps/],
    [{ minFaceDetectionConfidence: 1.2 }, /minFaceDetectionConfidence/],
    [{ minFacePresenceConfidence: -0.1 }, /minFacePresenceConfidence/],
    [{ minTrackingConfidence: Number.NaN }, /minTrackingConfidence/],
  ])("rejects invalid option %o", (options, message) => {
    expect(() => new MediaPipeEngine(options)).toThrow(message);
  });

  it("loads wasm and model from configurable paths, in VIDEO mode", async () => {
    const engine = new MediaPipeEngine({
      wasmBaseUrl: "https://cdn.example.com/wasm/",
      modelAssetPath: "/assets/face.task",
      maxFaces: 2,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.7,
      minTrackingConfidence: 0.8,
      withBlendshapes: false,
      withPose: false,
    });
    await engine.load();
    expect(state.filesetPaths).toEqual(["https://cdn.example.com/wasm"]);
    expect(state.createOptions[0]).toEqual({
      baseOptions: { modelAssetPath: "/assets/face.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 2,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.7,
      minTrackingConfidence: 0.8,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  });

  it("uses local default paths", async () => {
    await new MediaPipeEngine().load();
    expect(state.filesetPaths).toEqual(["/mediapipe/wasm"]);
    expect(state.createOptions[0]).toMatchObject({
      baseOptions: { modelAssetPath: "/models/face_landmarker.task" },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  });
});

describe("MediaPipeEngine lifecycle", () => {
  it("shares concurrent loads and resolves right away once loaded", async () => {
    const engine = new MediaPipeEngine();
    await Promise.all([engine.load(), engine.load()]);
    await engine.load();
    expect(state.createOptions).toHaveLength(1);
    expect(engine.isLoaded).toBe(true);
  });

  it("falls back to CPU when the GPU delegate fails", async () => {
    state.createErrors.GPU = new Error("no webgl");
    const engine = new MediaPipeEngine();
    await engine.load();
    expect(engine.isLoaded).toBe(true);
    expect(state.createOptions.map((o) => (o.baseOptions as { delegate: string }).delegate)).toEqual(["GPU", "CPU"]);
  });

  it("does not retry when CPU was requested", async () => {
    state.createErrors.CPU = new Error("bad model");
    const engine = new MediaPipeEngine({ delegate: "CPU" });
    await expect(engine.load()).rejects.toMatchObject({ code: "MODEL_LOAD_FAILED", engine: "mediapipe" });
    expect(state.createOptions).toHaveLength(1);
  });

  it("rejects with MODEL_LOAD_FAILED and can load again", async () => {
    state.createErrors.GPU = new Error("gpu");
    state.createErrors.CPU = new Error("cpu");
    const engine = new MediaPipeEngine();
    const error = await engine.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FaceEngineError);
    expect(error).toMatchObject({ code: "MODEL_LOAD_FAILED", cause: state.createErrors.GPU });
    expect(engine.isLoaded).toBe(false);

    state.createErrors = {};
    await engine.load();
    expect(engine.isLoaded).toBe(true);
  });

  it("reports wasm load failures", async () => {
    state.filesetError = new Error("404");
    await expect(new MediaPipeEngine().load()).rejects.toMatchObject({
      code: "MODEL_LOAD_FAILED",
      message: expect.stringContaining("wasm"),
    });
  });

  it("closes the landmarker on dispose, and is safe to dispose twice", async () => {
    const engine = new MediaPipeEngine();
    await engine.load();
    engine.dispose();
    engine.dispose();
    expect(state.closed).toBe(1);
    expect(engine.isLoaded).toBe(false);
    await engine.load();
    expect(engine.isLoaded).toBe(true);
  });

  it("discards a load that finishes after dispose", async () => {
    const engine = new MediaPipeEngine();
    const pending = engine.load();
    engine.dispose();
    await pending;
    expect(engine.isLoaded).toBe(false);
    expect(state.closed).toBe(1);
  });

  it("throws NOT_LOADED before load", async () => {
    await expect(new MediaPipeEngine().detect(canvas())).rejects.toMatchObject({ code: "NOT_LOADED" });
  });
});

describe("MediaPipeEngine.detect", () => {
  async function loaded(options = {}) {
    const engine = new MediaPipeEngine(options);
    await engine.load();
    return engine;
  }

  it("returns [] when there is no face", async () => {
    const engine = await loaded();
    expect(await engine.detect(canvas())).toEqual([]);
  });

  it("returns [] without running the model when the frame isn't ready", async () => {
    const engine = await loaded();
    expect(await engine.detect(video(0, 1))).toEqual([]);
    expect(await engine.detect(canvas(0, 0))).toEqual([]);
    expect(state.detectCalls).toHaveLength(0);
  });

  it("converts the mesh, blendshapes and pose to a FaceDetectionResult", async () => {
    state.result = face();
    const engine = await loaded();
    const [result] = await engine.detect(canvas());

    expect(result).toBeDefined();
    if (!result) return;
    expect(result.score).toBe(1);
    expect(result.imageSize).toEqual({ width: 640, height: 480 });
    expect(result.box.x).toBeCloseTo(0.2);
    expect(result.box.y).toBeCloseTo(0.1);
    expect(result.box.width).toBeCloseTo(0.45);
    expect(result.box.height).toBeCloseTo(0.72);

    expect(result.landmarks?.points).toHaveLength(478);
    expect(result.landmarks?.points[5]).toEqual({ x: 0.45, y: 0.1, z: 0.005 });
    const regions = result.landmarks?.regions;
    expect(regions?.rightEye).toHaveLength(6);
    expect(regions?.leftEye).toHaveLength(6);
    expect(regions?.mouthOuter).toHaveLength(12);
    expect(regions?.mouthInner).toHaveLength(8);
    expect(regions?.jawline).toHaveLength(17);
    expect(regions?.rightEyebrow).toHaveLength(5);
    expect(regions?.nose).toHaveLength(9);
    expect(regions?.rightEye[0]).toBe(result.landmarks?.points[33]);
    expect(regions?.mouthInner[2]).toBe(result.landmarks?.points[13]);

    expect(result.blendshapes).toEqual({ _neutral: 0.1, eyeBlinkLeft: 0.8, jawOpen: 0.3 });
    expect(result.pose).toMatchObject({ yaw: 0, pitch: 0, roll: 0, transformationMatrix: IDENTITY });
  });

  it("clamps the box to the frame", async () => {
    const points = mesh().map((p, i) => (i === 0 ? { ...p, x: -0.1, y: -0.2 } : i === 1 ? { ...p, x: 1.3 } : p));
    state.result = face({ faceLandmarks: [points] });
    const [result] = await (await loaded()).detect(canvas());
    expect(result?.box.x).toBe(0);
    expect(result?.box.y).toBe(0);
    expect(result?.box.width).toBe(1);
  });

  it("omits optional fields MediaPipe didn't compute", async () => {
    state.result = face({ faceLandmarks: [mesh(100)], faceBlendshapes: [], facialTransformationMatrixes: [] });
    const [result] = await (await loaded()).detect(canvas());
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("landmarks");
    expect(result).not.toHaveProperty("blendshapes");
    expect(result).not.toHaveProperty("pose");
  });

  it("returns at most maxFaces faces", async () => {
    state.result = face({ faceLandmarks: [mesh(), mesh(), mesh()] });
    const results = await (await loaded({ maxFaces: 2 })).detect(canvas());
    expect(results).toHaveLength(2);
  });

  it("wraps MediaPipe errors in DETECTION_FAILED", async () => {
    state.detectError = new Error("boom");
    const engine = await loaded();
    await expect(engine.detect(canvas())).rejects.toMatchObject({
      code: "DETECTION_FAILED",
      engine: "mediapipe",
      cause: state.detectError,
    });
  });

  it("sends strictly increasing timestamps", async () => {
    const engine = await loaded();
    await engine.detect(canvas());
    await engine.detect(canvas());
    now = 900; // clock going backwards must not break MediaPipe
    await engine.detect(canvas());
    const timestamps = state.detectCalls.map((c) => c.timestamp);
    expect(timestamps).toEqual([1000, 1001, 1002]);
  });
});

describe("MediaPipeEngine frame rate and redundant frames", () => {
  it("does not reprocess the same video frame", async () => {
    state.result = face();
    const engine = new MediaPipeEngine({ maxFps: Infinity });
    await engine.load();
    const el = video(1.0);

    const first = await engine.detect(el);
    now += 100;
    const second = await engine.detect(el);
    expect(state.detectCalls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);

    el.currentTime = 1.04;
    await engine.detect(el);
    expect(state.detectCalls).toHaveLength(2);
  });

  it("limits processing to maxFps", async () => {
    state.result = face();
    const engine = new MediaPipeEngine({ maxFps: 10 }); // one frame every 100 ms
    await engine.load();
    const el = video(0);

    for (let i = 0; i < 10; i++) {
      el.currentTime = i * 0.02;
      await engine.detect(el);
      now += 20;
    }
    // Calls every 20 ms from t = 0 to 180 ms: only t = 0 and t = 100 ms run the model.
    expect(state.detectCalls.map((c) => c.timestamp)).toEqual([1000, 1100]);
  });

  it("returns the cached result while throttled", async () => {
    state.result = face();
    const engine = new MediaPipeEngine({ maxFps: 10 });
    await engine.load();
    const el = video(0);
    const first = await engine.detect(el);
    state.result = null; // the face is gone, but the model doesn't run yet
    el.currentTime = 0.03;
    now += 30;
    expect(await engine.detect(el)).toEqual(first);
  });

  it("processes a different video element right away", async () => {
    const engine = new MediaPipeEngine({ maxFps: 1 });
    await engine.load();
    await engine.detect(video(0));
    await engine.detect(video(0));
    expect(state.detectCalls).toHaveLength(2);
  });

  it("always processes images and canvases", async () => {
    const engine = new MediaPipeEngine({ maxFps: 1 });
    await engine.load();
    const el = canvas();
    await engine.detect(el);
    await engine.detect(el);
    expect(state.detectCalls).toHaveLength(2);
  });

  it("forgets the cache on dispose", async () => {
    const engine = new MediaPipeEngine({ maxFps: 1 });
    await engine.load();
    const el = video(0);
    await engine.detect(el);
    engine.dispose();
    await engine.load();
    await engine.detect(el);
    expect(state.detectCalls).toHaveLength(2);
  });
});

describe("headPoseFromMatrix", () => {
  const deg = Math.PI / 180;
  // Column-major 4x4 from a 3x3 rotation given row by row.
  function matrix(r: number[][]): number[] {
    const at = (row: number, col: number) => r[row]?.[col] ?? 0;
    return [at(0, 0), at(1, 0), at(2, 0), 0, at(0, 1), at(1, 1), at(2, 1), 0, at(0, 2), at(1, 2), at(2, 2), 0, 0, 0, -40, 1];
  }
  const rotY = (a: number) => matrix([[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]);
  const rotX = (a: number) => matrix([[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]);
  const rotZ = (a: number) => matrix([[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]);

  it("is zero when facing the camera", () => {
    expect(headPoseFromMatrix(IDENTITY)).toMatchObject({ yaw: 0, pitch: 0, roll: 0 });
  });

  it("yaw > 0 when the face points to the image's left (subject's own right)", () => {
    // Rotating about +Y by -30° points the face's +Z toward the camera's -X.
    const pose = headPoseFromMatrix(rotY(-30 * deg));
    expect(pose?.yaw).toBeCloseTo(30);
    expect(pose?.pitch).toBeCloseTo(0);
    expect(pose?.roll).toBeCloseTo(0);
  });

  it("pitch > 0 when the subject looks up", () => {
    // Rotating about +X by -20° points the face's +Z toward +Y.
    const pose = headPoseFromMatrix(rotX(-20 * deg));
    expect(pose?.pitch).toBeCloseTo(20);
    expect(pose?.yaw).toBeCloseTo(0);
  });

  it("roll > 0 when the head tilts toward the subject's right shoulder", () => {
    // Counter-clockwise as seen by the camera: the top of the head moves to the image's left.
    const pose = headPoseFromMatrix(rotZ(15 * deg));
    expect(pose?.roll).toBeCloseTo(15);
    expect(pose?.yaw).toBeCloseTo(0);
  });

  it("rejects malformed matrices", () => {
    expect(headPoseFromMatrix([1, 2, 3])).toBeUndefined();
    expect(headPoseFromMatrix(IDENTITY.map((v, i) => (i === 0 ? Number.NaN : v)))).toBeUndefined();
  });
});

describe("MEDIAPIPE_TO_68", () => {
  it("uses valid mesh indices with the iBUG region sizes", () => {
    const sizes = Object.fromEntries(Object.entries(MEDIAPIPE_TO_68).map(([k, v]) => [k, v.length]));
    expect(sizes).toEqual({
      jawline: 17,
      rightEyebrow: 5,
      leftEyebrow: 5,
      nose: 9,
      rightEye: 6,
      leftEye: 6,
      mouthOuter: 12,
      mouthInner: 8,
    });
    const all = Object.values(MEDIAPIPE_TO_68).flat();
    expect(all.every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
    expect(new Set(all).size).toBe(68);
  });
});
