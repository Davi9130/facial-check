import { beforeEach, describe, expect, it, vi } from "vitest";
import { FaceApiEngine } from "../../src/engines/FaceApiEngine";
import { FaceEngineError, type FaceEngine } from "../../src/engines/FaceEngine";

interface FakeDetection {
  score: number;
  box: { x: number; y: number; width: number; height: number };
  relativeBox: { x: number; y: number; width: number; height: number };
}

const state = vi.hoisted(() => ({
  detections: [] as FakeDetection[],
  loadError: null as Error | null,
  detectError: null as Error | null,
  instances: [] as { kind: string; loadFromUri: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
  detectorOptions: [] as unknown[],
}));

vi.mock("face-api.js", () => {
  class FakeNet {
    isLoaded = false;
    readonly loadFromUri = vi.fn(async () => {
      if (state.loadError) throw state.loadError;
      this.isLoaded = true;
    });
    readonly dispose = vi.fn(() => {
      this.isLoaded = false;
    });
    constructor(readonly kind: string) {
      state.instances.push(this);
    }
  }
  class TinyFaceDetector extends FakeNet {
    constructor() {
      super("detector");
    }
    async locateFaces(_input: unknown, options: unknown): Promise<FakeDetection[]> {
      state.detectorOptions.push(options);
      if (state.detectError) throw state.detectError;
      return [...state.detections];
    }
  }
  // 68 points in crop coordinates: point i is at (i, 2i).
  const cropLandmarks = Array.from({ length: 68 }, (_, i) => ({ x: i, y: 2 * i }));
  class FaceLandmark68Net extends FakeNet {
    constructor(kind = "landmarks-full") {
      super(kind);
    }
    async detectLandmarks() {
      return {
        shiftBy: (x: number, y: number) => ({
          positions: cropLandmarks.map((p) => ({ x: p.x + x, y: p.y + y })),
        }),
      };
    }
  }
  class FaceLandmark68TinyNet extends FaceLandmark68Net {
    constructor() {
      super("landmarks-tiny");
    }
  }
  class TinyFaceDetectorOptions {
    constructor(readonly params: unknown) {}
  }
  const extractFaces = vi.fn(async (_input: unknown, detections: FakeDetection[]) => detections.map(() => ({})));
  return { TinyFaceDetector, FaceLandmark68Net, FaceLandmark68TinyNet, TinyFaceDetectorOptions, extractFaces };
});

function canvas(width = 200, height = 100): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
}

function detection(score: number, x: number, y: number, w: number, h: number): FakeDetection {
  return { score, box: { x: x * 200, y: y * 100, width: w * 200, height: h * 100 }, relativeBox: { x, y, width: w, height: h } };
}

beforeEach(() => {
  state.detections = [];
  state.loadError = null;
  state.detectError = null;
  state.instances = [];
  state.detectorOptions = [];
});

describe("FaceApiEngine", () => {
  it("implements the FaceEngine contract", () => {
    const engine: FaceEngine = new FaceApiEngine();
    expect(engine.name).toBe("face-api");
    expect(engine.isLoaded).toBe(false);
  });

  it("loads the detector and the 68-landmark net from the configured base URL", async () => {
    const engine = new FaceApiEngine({ modelBaseUrl: "https://cdn.example.com/models/" });
    await engine.load();

    expect(engine.isLoaded).toBe(true);
    expect(state.instances.map((n) => n.kind)).toEqual(["detector", "landmarks-full"]);
    for (const net of state.instances) {
      expect(net.loadFromUri).toHaveBeenCalledWith("https://cdn.example.com/models");
    }
  });

  it("loads the tiny landmark net, or none, when configured", async () => {
    await new FaceApiEngine({ landmarkModel: "tiny" }).load();
    expect(state.instances.map((n) => n.kind)).toEqual(["detector", "landmarks-tiny"]);

    state.instances = [];
    await new FaceApiEngine({ withLandmarks: false }).load();
    expect(state.instances.map((n) => n.kind)).toEqual(["detector"]);
  });

  it("shares concurrent loads and does not reload once loaded", async () => {
    const engine = new FaceApiEngine();
    await Promise.all([engine.load(), engine.load()]);
    await engine.load();
    expect(state.instances).toHaveLength(2);
    expect(state.instances[0]?.loadFromUri).toHaveBeenCalledTimes(1);
  });

  it("rejects with MODEL_LOAD_FAILED, releases partial nets, and can retry", async () => {
    const engine = new FaceApiEngine();
    state.loadError = new Error("404");

    const error = await engine.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FaceEngineError);
    expect(error).toMatchObject({ code: "MODEL_LOAD_FAILED", engine: "face-api" });
    expect(engine.isLoaded).toBe(false);

    state.loadError = null;
    await engine.load();
    expect(engine.isLoaded).toBe(true);
  });

  it("throws NOT_LOADED when detecting before load", async () => {
    await expect(new FaceApiEngine().detect(canvas())).rejects.toMatchObject({ code: "NOT_LOADED" });
  });

  it("returns typed, normalized results with landmarks grouped by region", async () => {
    const engine = new FaceApiEngine({ inputSize: 320, scoreThreshold: 0.6 });
    await engine.load();
    state.detections = [detection(0.9, 0.25, 0.2, 0.5, 0.6)];

    const [face, ...rest] = await engine.detect(canvas(200, 100));

    expect(rest).toEqual([]);
    expect(state.detectorOptions[0]).toMatchObject({ params: { inputSize: 320, scoreThreshold: 0.6 } });
    expect(face).toMatchObject({
      score: 0.9,
      imageSize: { width: 200, height: 100 },
      box: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
    });
    expect(face?.blendshapes).toBeUndefined();
    expect(face?.pose).toBeUndefined();

    const landmarks = face?.landmarks;
    expect(landmarks?.points).toHaveLength(68);
    // Point 0 at crop (0, 0) shifted by the box origin (50px, 20px), normalized by 200x100.
    expect(landmarks?.points[0]).toEqual({ x: 0.25, y: 0.2 });
    // Point 36 at crop (36, 72) → pixel (86, 92).
    expect(landmarks?.regions.rightEye[0]).toEqual({ x: 86 / 200, y: 92 / 100 });

    const sizes = Object.fromEntries(Object.entries(landmarks?.regions ?? {}).map(([k, v]) => [k, v.length]));
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
    expect(landmarks?.regions.leftEye[0]).toBe(landmarks?.points[42]);
    expect(landmarks?.regions.mouthInner[7]).toBe(landmarks?.points[67]);
  });

  it("returns the highest-scoring faces up to maxFaces, with clamped boxes", async () => {
    const engine = new FaceApiEngine({ maxFaces: 2, withLandmarks: false });
    await engine.load();
    state.detections = [detection(0.6, 0, 0, 0.1, 0.1), detection(0.95, -0.1, 0.8, 0.5, 0.4), detection(0.8, 0.5, 0.5, 0.1, 0.1)];

    const faces = await engine.detect(canvas());

    expect(faces.map((f) => f.score)).toEqual([0.95, 0.8]);
    expect(faces[0]?.box.x).toBe(0);
    expect(faces[0]?.box.width).toBeCloseTo(0.4);
    expect(faces[0]?.box.height).toBeCloseTo(0.2);
    expect(faces[0]?.landmarks).toBeUndefined();
  });

  it("returns no faces when none are found or the frame is not ready", async () => {
    const engine = new FaceApiEngine();
    await engine.load();
    expect(await engine.detect(canvas())).toEqual([]);

    state.detections = [detection(0.9, 0.1, 0.1, 0.5, 0.5)];
    const video = document.createElement("video"); // readyState 0: HAVE_NOTHING
    expect(await engine.detect(video)).toEqual([]);
    expect(await engine.detect(canvas(0, 0))).toEqual([]);
    expect(state.detectorOptions).toHaveLength(1);
  });

  it("wraps detection errors as DETECTION_FAILED", async () => {
    const engine = new FaceApiEngine();
    await engine.load();
    state.detectError = new Error("webgl lost");

    const error = await engine.detect(canvas()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "DETECTION_FAILED", name: "FaceEngineError" });
    expect((error as Error).cause).toBe(state.detectError);
  });

  it("disposes its own nets and can be loaded again", async () => {
    const engine = new FaceApiEngine();
    await engine.load();
    const [detector, landmarkNet] = state.instances;

    engine.dispose();
    engine.dispose();

    expect(engine.isLoaded).toBe(false);
    expect(detector?.dispose).toHaveBeenCalledTimes(1);
    expect(landmarkNet?.dispose).toHaveBeenCalledTimes(1);
    await expect(engine.detect(canvas())).rejects.toMatchObject({ code: "NOT_LOADED" });

    await engine.load();
    expect(engine.isLoaded).toBe(true);
    expect(state.instances).toHaveLength(4);
  });

  it("discards a load that finishes after dispose", async () => {
    const engine = new FaceApiEngine();
    const pending = engine.load();
    engine.dispose();
    await pending;

    expect(engine.isLoaded).toBe(false);
    for (const net of state.instances) expect(net.dispose).toHaveBeenCalled();
  });

  it("validates options", () => {
    expect(() => new FaceApiEngine({ inputSize: 100 })).toThrow(RangeError);
    expect(() => new FaceApiEngine({ scoreThreshold: 2 })).toThrow(RangeError);
    expect(() => new FaceApiEngine({ maxFaces: 0 })).toThrow(RangeError);
  });
});
