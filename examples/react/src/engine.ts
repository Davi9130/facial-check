import type { FacialCheckConfig } from "facial-check";

/** Built-in engine names accepted by `engine` (`FacialCheckConfig["engine"]` minus custom instances). */
export type EngineName = Extract<FacialCheckConfig["engine"], string>;

/**
 * Where the demo serves the model files (see `npm run setup`). These are the
 * SDK defaults, repeated here to show where to change them.
 */
export const engineOptions = {
  faceApi: { modelBaseUrl: "/models" },
  mediapipe: { modelAssetPath: "/models/face_landmarker.task", wasmBaseUrl: "/mediapipe/wasm" },
} as const;
