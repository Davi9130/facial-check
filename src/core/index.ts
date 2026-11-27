/**
 * Entry point: `facial-check/core`
 *
 * Building blocks of the SDK (e.g. `FaceEngine`, `FaceAnalyzer`, sessions, events).
 * Must not depend on React. Symbols are added by the tasks that implement them.
 */
export {};
export type * from "../types/face.types";
export { FaceEngineError, isFaceEngineError, type FaceEngine, type FaceEngineErrorCode } from "../engines/FaceEngine";
export {
  FaceApiEngine,
  FACE_API_MODEL_FILES,
  type FaceApiEngineOptions,
  type FaceApiLandmarkModel,
} from "../engines/FaceApiEngine";
