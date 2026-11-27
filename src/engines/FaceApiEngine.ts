import type * as FaceApi from "face-api.js";
import type {
  FaceBoundingBox,
  FaceDetectionResult,
  FaceEngineInput,
  FaceImageSize,
  FaceLandmarkRegions,
  FaceLandmarks,
  FacePoint,
} from "../types/face.types";
import { FaceEngineError, type FaceEngine } from "./FaceEngine";
import { getImageSize } from "./frame";

type FaceApiModule = typeof FaceApi;

export type FaceApiLandmarkModel = "full" | "tiny";

export interface FaceApiEngineOptions {
  /**
   * URL or base path the model files are served from (see "Model files" in the README).
   * Default: `"/models"`.
   */
  modelBaseUrl?: string;
  /**
   * TinyFaceDetector input size. Must be a multiple of 32; smaller is faster,
   * larger finds smaller faces. Default: `224`.
   */
  inputSize?: number;
  /** Minimum detection score, from 0 to 1. Default: `0.5`. */
  scoreThreshold?: number;
  /** Compute the 68 landmarks for each face. Default: `true`. */
  withLandmarks?: boolean;
  /** `"full"` (face_landmark_68_model, ~350 KB) or `"tiny"` (~80 KB, less precise). Default: `"full"`. */
  landmarkModel?: FaceApiLandmarkModel;
  /** Maximum number of faces returned, highest score first. Default: `1`. */
  maxFaces?: number;
}

/** Model files `FaceApiEngine` loads from `modelBaseUrl`, by landmark model. */
export const FACE_API_MODEL_FILES = {
  detector: ["tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model-shard1"],
  full: ["face_landmark_68_model-weights_manifest.json", "face_landmark_68_model-shard1"],
  tiny: ["face_landmark_68_tiny_model-weights_manifest.json", "face_landmark_68_tiny_model-shard1"],
} as const;

const ENGINE_NAME = "face-api";

interface LoadedNets {
  readonly faceapi: FaceApiModule;
  readonly detector: FaceApi.TinyFaceDetector;
  readonly landmarkNet: FaceApi.FaceLandmark68Net | FaceApi.FaceLandmark68TinyNet | null;
}

/**
 * `FaceEngine` backed by face-api.js 0.22.2: TinyFaceDetector for detection and
 * the 68-point landmark net for landmarks.
 *
 * face-api.js is imported lazily on `load()`, so apps that only use another
 * engine don't download it. Each instance owns its networks (it does not use
 * face-api's global `nets`), so disposing one engine never affects another.
 * Frames are processed locally and never leave the browser.
 */
export class FaceApiEngine implements FaceEngine {
  readonly name = ENGINE_NAME;

  private readonly modelBaseUrl: string;
  private readonly inputSize: number;
  private readonly scoreThreshold: number;
  private readonly withLandmarks: boolean;
  private readonly landmarkModel: FaceApiLandmarkModel;
  private readonly maxFaces: number;

  private nets: LoadedNets | null = null;
  private loading: Promise<void> | null = null;
  /** Bumped by `dispose()`, so a load that finishes after it is discarded. */
  private generation = 0;

  constructor(options: FaceApiEngineOptions = {}) {
    const inputSize = options.inputSize ?? 224;
    if (!Number.isInteger(inputSize) || inputSize <= 0 || inputSize % 32 !== 0) {
      throw new RangeError(`FaceApiEngine: inputSize must be a positive multiple of 32 (got ${inputSize}).`);
    }
    const scoreThreshold = options.scoreThreshold ?? 0.5;
    if (!(scoreThreshold >= 0 && scoreThreshold <= 1)) {
      throw new RangeError(`FaceApiEngine: scoreThreshold must be between 0 and 1 (got ${scoreThreshold}).`);
    }
    const maxFaces = options.maxFaces ?? 1;
    if (!Number.isInteger(maxFaces) || maxFaces < 1) {
      throw new RangeError(`FaceApiEngine: maxFaces must be a positive integer (got ${maxFaces}).`);
    }

    this.modelBaseUrl = (options.modelBaseUrl ?? "/models").replace(/\/+$/, "") || "/";
    this.inputSize = inputSize;
    this.scoreThreshold = scoreThreshold;
    this.withLandmarks = options.withLandmarks ?? true;
    this.landmarkModel = options.landmarkModel ?? "full";
    this.maxFaces = maxFaces;
  }

  get isLoaded(): boolean {
    return this.nets !== null;
  }

  load(): Promise<void> {
    if (this.nets) return Promise.resolve();
    if (!this.loading) {
      const generation = this.generation;
      this.loading = this.loadNets()
        .then((nets) => {
          if (generation !== this.generation) {
            disposeNets(nets);
            return;
          }
          this.nets = nets;
        })
        .finally(() => {
          if (generation === this.generation) this.loading = null;
        });
    }
    return this.loading;
  }

  async detect(input: FaceEngineInput): Promise<FaceDetectionResult[]> {
    const nets = this.nets;
    if (!nets) {
      throw new FaceEngineError("NOT_LOADED", ENGINE_NAME, "FaceApiEngine: call load() before detect().");
    }

    const imageSize = getImageSize(input);
    if (!imageSize) return [];

    try {
      const options = new nets.faceapi.TinyFaceDetectorOptions({
        inputSize: this.inputSize,
        scoreThreshold: this.scoreThreshold,
      });
      const detections = (await nets.detector.locateFaces(input, options))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxFaces);
      if (detections.length === 0) return [];

      let landmarks: (FaceLandmarks | undefined)[] = [];
      if (nets.landmarkNet) {
        const landmarkNet = nets.landmarkNet;
        const faces = await nets.faceapi.extractFaces(input, detections);
        landmarks = await Promise.all(
          faces.map(async (face, i) => {
            const result = await landmarkNet.detectLandmarks(face);
            const raw = Array.isArray(result) ? result[0] : result;
            const detection = detections[i];
            if (!raw || !detection) return undefined;
            const shifted = raw.shiftBy(detection.box.x, detection.box.y);
            return toLandmarks(shifted.positions, imageSize);
          }),
        );
      }

      return detections.map((detection, i): FaceDetectionResult => {
        const box = toBox(detection.relativeBox);
        const faceLandmarks = landmarks[i];
        return faceLandmarks
          ? { box, score: detection.score, imageSize, landmarks: faceLandmarks }
          : { box, score: detection.score, imageSize };
      });
    } catch (error) {
      throw new FaceEngineError("DETECTION_FAILED", ENGINE_NAME, "FaceApiEngine: face detection failed.", {
        cause: error,
      });
    }
  }

  dispose(): void {
    this.generation += 1;
    this.loading = null;
    if (this.nets) {
      disposeNets(this.nets);
      this.nets = null;
    }
  }

  private async loadNets(): Promise<LoadedNets> {
    let faceapi: FaceApiModule;
    try {
      faceapi = await import("face-api.js");
    } catch (error) {
      throw new FaceEngineError("MODEL_LOAD_FAILED", ENGINE_NAME, "FaceApiEngine: could not import face-api.js.", {
        cause: error,
      });
    }

    const detector = new faceapi.TinyFaceDetector();
    const landmarkNet = this.withLandmarks
      ? this.landmarkModel === "tiny"
        ? new faceapi.FaceLandmark68TinyNet()
        : new faceapi.FaceLandmark68Net()
      : null;
    const nets: LoadedNets = { faceapi, detector, landmarkNet };

    try {
      await Promise.all([
        detector.loadFromUri(this.modelBaseUrl),
        landmarkNet ? landmarkNet.loadFromUri(this.modelBaseUrl) : Promise.resolve(),
      ]);
    } catch (error) {
      disposeNets(nets);
      throw new FaceEngineError(
        "MODEL_LOAD_FAILED",
        ENGINE_NAME,
        `FaceApiEngine: could not load models from "${this.modelBaseUrl}".`,
        { cause: error },
      );
    }
    return nets;
  }
}

function disposeNets(nets: LoadedNets): void {
  for (const net of [nets.detector, nets.landmarkNet]) {
    if (net?.isLoaded) net.dispose();
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Clamps a [start, start + size] span to [0, 1], keeping the exact size when no clamping is needed. */
function clampSpan(start: number, size: number): [number, number] {
  const end = start + size;
  if (start >= 0 && end <= 1) return [start, size];
  const clampedStart = clamp01(start);
  return [clampedStart, clamp01(end) - clampedStart];
}

function toBox(relative: FaceApi.IRect): FaceBoundingBox {
  const [x, width] = clampSpan(relative.x, relative.width);
  const [y, height] = clampSpan(relative.y, relative.height);
  return { x, y, width, height };
}

/** iBUG 68-point index ranges ([start, end)) per region. */
const REGIONS_68: Record<keyof FaceLandmarkRegions, readonly [number, number]> = {
  jawline: [0, 17],
  rightEyebrow: [17, 22],
  leftEyebrow: [22, 27],
  nose: [27, 36],
  rightEye: [36, 42],
  leftEye: [42, 48],
  mouthOuter: [48, 60],
  mouthInner: [60, 68],
};

function toLandmarks(positions: readonly FaceApi.IPoint[], imageSize: FaceImageSize): FaceLandmarks {
  const points: FacePoint[] = positions.map((p) => ({ x: p.x / imageSize.width, y: p.y / imageSize.height }));
  const region = (key: keyof FaceLandmarkRegions): FacePoint[] => points.slice(...REGIONS_68[key]);
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
