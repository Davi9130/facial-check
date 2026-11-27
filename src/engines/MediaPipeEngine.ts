import type * as TasksVision from "@mediapipe/tasks-vision";
import type {
  FaceBlendshapes,
  FaceBoundingBox,
  FaceDetectionResult,
  FaceEngineInput,
  FaceImageSize,
  FaceLandmarkRegions,
  FaceLandmarks,
  FacePoint,
  HeadPose,
} from "../types/face.types";
import { FaceEngineError, type FaceEngine } from "./FaceEngine";
import { getImageSize, isVideoElement } from "./frame";

type TasksVisionModule = typeof TasksVision;

export type MediaPipeDelegate = "GPU" | "CPU";

export interface MediaPipeEngineOptions {
  /**
   * URL or base path of the `@mediapipe/tasks-vision` `wasm/` folder (see "Model files" in the README).
   * Default: `"/mediapipe/wasm"`.
   */
  wasmBaseUrl?: string;
  /** URL of the `face_landmarker.task` model. Default: `"/models/face_landmarker.task"`. */
  modelAssetPath?: string;
  /**
   * Where inference runs. With `"GPU"`, the engine falls back to `"CPU"` when the GPU
   * delegate can't be created (e.g. no WebGL). Default: `"GPU"`.
   */
  delegate?: MediaPipeDelegate;
  /** Maximum number of faces returned. Default: `1`. */
  maxFaces?: number;
  /** Minimum face detection confidence, from 0 to 1. Default: `0.5`. */
  minFaceDetectionConfidence?: number;
  /** Minimum face presence confidence, from 0 to 1. Default: `0.5`. */
  minFacePresenceConfidence?: number;
  /** Minimum tracking confidence, from 0 to 1. Default: `0.5`. */
  minTrackingConfidence?: number;
  /** Compute blendshapes (`eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`, …). Default: `true`. */
  withBlendshapes?: boolean;
  /** Compute head pose from the facial transformation matrix. Default: `true`. */
  withPose?: boolean;
  /**
   * Maximum number of video frames processed per second. Calls in between return the
   * last result without running the model. `Infinity` disables the limit. Default: `30`.
   */
  maxFps?: number;
}

/** Files `MediaPipeEngine` loads: the wasm runtime (from `wasmBaseUrl`) and the model (`modelAssetPath`). */
export const MEDIAPIPE_MODEL_FILES = {
  wasm: [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_module_internal.js",
    "vision_wasm_module_internal.wasm",
  ],
  model: ["face_landmarker.task"],
} as const;

const ENGINE_NAME = "mediapipe";
const RAD_TO_DEG = 180 / Math.PI;

/** Cache of the last processed video frame, so the same frame is never processed twice. */
interface FrameCache {
  readonly video: HTMLVideoElement;
  readonly videoTime: number;
  readonly processedAt: number;
  readonly results: readonly FaceDetectionResult[];
}

/**
 * `FaceEngine` backed by MediaPipe Tasks Vision `FaceLandmarker` in `VIDEO` mode:
 * 478-point face mesh, blendshapes and head pose.
 *
 * `@mediapipe/tasks-vision` is imported lazily on `load()`. For `<video>` inputs the
 * engine skips frames it already processed (same `currentTime`) and frames above
 * `maxFps`, returning the last result instead. `<img>` and `<canvas>` inputs are always
 * processed. Frames are processed locally and never leave the browser.
 *
 * The mesh is mapped to the iBUG 68-point layout in `landmarks.regions`, so the eye
 * and mouth metrics work the same as with `FaceApiEngine`. `landmarks.points` keeps
 * all mesh points with their `z`. FaceLandmarker has no per-face confidence:
 * faces below `minFacePresenceConfidence` are dropped, and returned faces have `score: 1`.
 */
export class MediaPipeEngine implements FaceEngine {
  readonly name = ENGINE_NAME;

  private readonly wasmBaseUrl: string;
  private readonly modelAssetPath: string;
  private readonly delegate: MediaPipeDelegate;
  private readonly maxFaces: number;
  private readonly minFaceDetectionConfidence: number;
  private readonly minFacePresenceConfidence: number;
  private readonly minTrackingConfidence: number;
  private readonly withBlendshapes: boolean;
  private readonly withPose: boolean;
  private readonly minFrameIntervalMs: number;

  private landmarker: TasksVision.FaceLandmarker | null = null;
  private loading: Promise<void> | null = null;
  /** Bumped by `dispose()`, so a load that finishes after it is discarded. */
  private generation = 0;
  /** Last timestamp sent to MediaPipe, which requires strictly increasing timestamps. */
  private lastTimestamp = -1;
  private cache: FrameCache | null = null;

  constructor(options: MediaPipeEngineOptions = {}) {
    const maxFaces = options.maxFaces ?? 1;
    if (!Number.isInteger(maxFaces) || maxFaces < 1) {
      throw new RangeError(`MediaPipeEngine: maxFaces must be a positive integer (got ${maxFaces}).`);
    }
    const maxFps = options.maxFps ?? 30;
    if (!(maxFps > 0)) {
      throw new RangeError(`MediaPipeEngine: maxFps must be greater than 0 (got ${maxFps}).`);
    }

    this.wasmBaseUrl = (options.wasmBaseUrl ?? "/mediapipe/wasm").replace(/\/+$/, "") || "/";
    this.modelAssetPath = options.modelAssetPath ?? "/models/face_landmarker.task";
    this.delegate = options.delegate ?? "GPU";
    this.maxFaces = maxFaces;
    this.minFaceDetectionConfidence = confidence("minFaceDetectionConfidence", options.minFaceDetectionConfidence);
    this.minFacePresenceConfidence = confidence("minFacePresenceConfidence", options.minFacePresenceConfidence);
    this.minTrackingConfidence = confidence("minTrackingConfidence", options.minTrackingConfidence);
    this.withBlendshapes = options.withBlendshapes ?? true;
    this.withPose = options.withPose ?? true;
    this.minFrameIntervalMs = 1000 / maxFps;
  }

  get isLoaded(): boolean {
    return this.landmarker !== null;
  }

  load(): Promise<void> {
    if (this.landmarker) return Promise.resolve();
    if (!this.loading) {
      const generation = this.generation;
      this.loading = this.createLandmarker()
        .then((landmarker) => {
          if (generation !== this.generation) {
            landmarker.close();
            return;
          }
          this.landmarker = landmarker;
        })
        .finally(() => {
          if (generation === this.generation) this.loading = null;
        });
    }
    return this.loading;
  }

  async detect(input: FaceEngineInput): Promise<FaceDetectionResult[]> {
    const landmarker = this.landmarker;
    if (!landmarker) {
      throw new FaceEngineError("NOT_LOADED", ENGINE_NAME, "MediaPipeEngine: call load() before detect().");
    }

    const imageSize = getImageSize(input);
    if (!imageSize) return [];

    const now = performance.now();
    const video = isVideoElement(input) ? input : null;
    const cache = this.cache;
    if (video && cache && cache.video === video) {
      const sameFrame = cache.videoTime === video.currentTime;
      const tooSoon = now - cache.processedAt < this.minFrameIntervalMs;
      if (sameFrame || tooSoon) return [...cache.results];
    }

    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    let results: FaceDetectionResult[];
    try {
      const raw = landmarker.detectForVideo(input, timestamp);
      results = toResults(raw, imageSize, this.maxFaces);
    } catch (error) {
      throw new FaceEngineError("DETECTION_FAILED", ENGINE_NAME, "MediaPipeEngine: face detection failed.", {
        cause: error,
      });
    }

    this.cache = video ? { video, videoTime: video.currentTime, processedAt: now, results } : null;
    return [...results];
  }

  dispose(): void {
    this.generation += 1;
    this.loading = null;
    this.cache = null;
    this.lastTimestamp = -1;
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }

  private async createLandmarker(): Promise<TasksVision.FaceLandmarker> {
    let vision: TasksVisionModule;
    try {
      vision = await import("@mediapipe/tasks-vision");
    } catch (error) {
      throw new FaceEngineError(
        "MODEL_LOAD_FAILED",
        ENGINE_NAME,
        "MediaPipeEngine: could not import @mediapipe/tasks-vision.",
        { cause: error },
      );
    }

    let fileset: Awaited<ReturnType<TasksVisionModule["FilesetResolver"]["forVisionTasks"]>>;
    try {
      fileset = await vision.FilesetResolver.forVisionTasks(this.wasmBaseUrl);
    } catch (error) {
      throw new FaceEngineError(
        "MODEL_LOAD_FAILED",
        ENGINE_NAME,
        `MediaPipeEngine: could not load the wasm runtime from "${this.wasmBaseUrl}".`,
        { cause: error },
      );
    }

    const create = (delegate: MediaPipeDelegate) =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.modelAssetPath, delegate },
        runningMode: "VIDEO",
        numFaces: this.maxFaces,
        minFaceDetectionConfidence: this.minFaceDetectionConfidence,
        minFacePresenceConfidence: this.minFacePresenceConfidence,
        minTrackingConfidence: this.minTrackingConfidence,
        outputFaceBlendshapes: this.withBlendshapes,
        outputFacialTransformationMatrixes: this.withPose,
      });

    try {
      return await create(this.delegate);
    } catch (error) {
      if (this.delegate === "GPU") {
        try {
          return await create("CPU");
        } catch {
          // Report the original GPU error below.
        }
      }
      throw new FaceEngineError(
        "MODEL_LOAD_FAILED",
        ENGINE_NAME,
        `MediaPipeEngine: could not load the model from "${this.modelAssetPath}".`,
        { cause: error },
      );
    }
  }
}

function confidence(name: string, value: number | undefined): number {
  const v = value ?? 0.5;
  if (!(v >= 0 && v <= 1)) {
    throw new RangeError(`MediaPipeEngine: ${name} must be between 0 and 1 (got ${v}).`);
  }
  return v;
}

function toResults(
  raw: TasksVision.FaceLandmarkerResult,
  imageSize: FaceImageSize,
  maxFaces: number,
): FaceDetectionResult[] {
  const results: FaceDetectionResult[] = [];
  for (const [i, mesh] of raw.faceLandmarks.slice(0, maxFaces).entries()) {
    const box = toBox(mesh);
    if (!box) continue;
    const landmarks = toLandmarks(mesh);
    const blendshapes = toBlendshapes(raw.faceBlendshapes?.[i]);
    const pose = toPose(raw.facialTransformationMatrixes?.[i]);
    results.push({
      box,
      score: 1,
      imageSize,
      ...(landmarks && { landmarks }),
      ...(blendshapes && { blendshapes }),
      ...(pose && { pose }),
    });
  }
  return results;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Tight box around the mesh, clamped to the frame. `null` for an empty mesh. */
function toBox(mesh: readonly TasksVision.NormalizedLandmark[]): FaceBoundingBox | null {
  if (mesh.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of mesh) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = clamp01(minX);
  const y = clamp01(minY);
  return { x, y, width: clamp01(maxX) - x, height: clamp01(maxY) - y };
}

/**
 * Face mesh indices mapped to the iBUG 68-point layout, per region, in the order
 * `FaceLandmarkRegions` documents. Indices are for the standard 468/478-point mesh,
 * on a non-mirrored frame (the subject's right side is on the left of the image).
 */
export const MEDIAPIPE_TO_68: Readonly<Record<keyof FaceLandmarkRegions, readonly number[]>> = {
  jawline: [127, 234, 93, 132, 58, 172, 136, 150, 152, 379, 365, 397, 288, 361, 323, 454, 356],
  rightEyebrow: [70, 63, 105, 66, 107],
  leftEyebrow: [336, 296, 334, 293, 300],
  nose: [168, 6, 197, 4, 98, 97, 2, 326, 327],
  rightEye: [33, 160, 158, 133, 153, 144],
  leftEye: [362, 385, 387, 263, 373, 380],
  mouthOuter: [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91],
  mouthInner: [78, 81, 13, 311, 308, 402, 14, 178],
};

const MIN_MESH_POINTS = 468;

/** `undefined` when the mesh is smaller than the standard 468-point mesh. */
function toLandmarks(mesh: readonly TasksVision.NormalizedLandmark[]): FaceLandmarks | undefined {
  if (mesh.length < MIN_MESH_POINTS) return undefined;
  const points: FacePoint[] = mesh.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const region = (key: keyof FaceLandmarkRegions): FacePoint[] =>
    MEDIAPIPE_TO_68[key].map((index) => points[index] as FacePoint);
  return {
    points,
    regions: {
      jawline: region("jawline"),
      rightEyebrow: region("rightEyebrow"),
      leftEyebrow: region("leftEyebrow"),
      nose: region("nose"),
      rightEye: region("rightEye"),
      leftEye: region("leftEye"),
      mouthOuter: region("mouthOuter"),
      mouthInner: region("mouthInner"),
    },
  };
}

function toBlendshapes(classifications: TasksVision.Classifications | undefined): FaceBlendshapes | undefined {
  if (!classifications || classifications.categories.length === 0) return undefined;
  const blendshapes: Record<string, number> = {};
  for (const category of classifications.categories) {
    if (category.categoryName) blendshapes[category.categoryName] = category.score;
  }
  return blendshapes;
}

/**
 * Head pose from MediaPipe's 4x4 column-major facial transformation matrix.
 *
 * MediaPipe's camera looks down -Z with +X to the right of the image and +Y up, and
 * the canonical face looks toward +Z with its +X toward the subject's left. So:
 * - forward vector f = R·(0,0,1): yaw = atan2(-f.x, f.z), pitch = atan2(f.y, √(f.x²+f.z²));
 * - roll = atan2(R[1][0], R[0][0]), positive when the head tilts toward the subject's right shoulder.
 */
export function headPoseFromMatrix(data: readonly number[]): HeadPose | undefined {
  if (data.length !== 16 || !data.every(Number.isFinite)) return undefined;
  // Column-major: element (row r, column c) is data[c * 4 + r].
  const m = (r: number, c: number): number => data[c * 4 + r] as number;
  const fx = m(0, 2);
  const fy = m(1, 2);
  const fz = m(2, 2);
  return {
    yaw: degrees(Math.atan2(-fx, fz)),
    pitch: degrees(Math.atan2(fy, Math.hypot(fx, fz))),
    roll: degrees(Math.atan2(m(1, 0), m(0, 0))),
    transformationMatrix: [...data],
  };
}

/** Radians to degrees, without returning `-0`. */
function degrees(radians: number): number {
  return radians * RAD_TO_DEG + 0;
}

function toPose(matrix: TasksVision.Matrix | undefined): HeadPose | undefined {
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4) return undefined;
  return headPoseFromMatrix(matrix.data);
}
