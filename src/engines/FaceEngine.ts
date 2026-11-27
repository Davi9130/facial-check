import type { FaceDetectionResult, FaceEngineInput } from "../types/face.types";

/**
 * Common contract for face detection engines.
 *
 * An engine turns a video, image or canvas frame into engine-agnostic
 * `FaceDetectionResult`s. It does not depend on React or on the camera module:
 * any frame source works. New engines implement this interface; nothing else
 * in the SDK needs to change.
 *
 * Lifecycle: `load()` → any number of `detect()` calls → `dispose()`.
 * `load()` can be called again after `dispose()`.
 */
export interface FaceEngine {
  /** Stable engine identifier, e.g. `"face-api"` or `"mediapipe"`. */
  readonly name: string;
  /** `true` once `load()` resolved and until `dispose()` is called. */
  readonly isLoaded: boolean;
  /**
   * Loads models and allocates resources. Concurrent calls share the same
   * load, and calls on a loaded engine resolve right away.
   * Rejects with a `FaceEngineError` (`MODEL_LOAD_FAILED`); the engine can then be loaded again.
   */
  load(): Promise<void>;
  /**
   * Detects faces in the current frame, highest score first.
   * Resolves with an empty array when no face is found or the frame is not ready yet.
   * Rejects with a `FaceEngineError` (`NOT_LOADED`, `DETECTION_FAILED`).
   */
  detect(input: FaceEngineInput): Promise<FaceDetectionResult[]>;
  /** Releases models and memory. Safe to call more than once. */
  dispose(): void;
}

export type FaceEngineErrorCode = "MODEL_LOAD_FAILED" | "NOT_LOADED" | "DETECTION_FAILED";

/** Error thrown by every `FaceEngine` implementation. Messages never contain image data. */
export class FaceEngineError extends Error {
  override readonly name = "FaceEngineError";
  readonly code: FaceEngineErrorCode;
  /** Name of the engine that raised the error. */
  readonly engine: string;

  constructor(code: FaceEngineErrorCode, engine: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.engine = engine;
  }
}

export function isFaceEngineError(error: unknown): error is FaceEngineError {
  return error instanceof FaceEngineError;
}
