# Model files

`facial-check` does not ship model weights in the npm package. Your app serves them as static files, and the engines download them at runtime from the URL you configure. Frames never leave the browser; only the weight files are fetched.

## FaceApiEngine (face-api.js 0.22.2)

| File | Needed when |
| --- | --- |
| `tiny_face_detector_model-weights_manifest.json` | always |
| `tiny_face_detector_model-shard1` | always |
| `face_landmark_68_model-weights_manifest.json` | `landmarkModel: "full"` (default) |
| `face_landmark_68_model-shard1` | `landmarkModel: "full"` (default) |
| `face_landmark_68_tiny_model-weights_manifest.json` | `landmarkModel: "tiny"` |
| `face_landmark_68_tiny_model-shard1` | `landmarkModel: "tiny"` |

The shards are about 190 KB (detector), 350 KB (full landmarks) and 80 KB (tiny landmarks). With `withLandmarks: false`, only the two `tiny_face_detector_model` files are needed. The same list is exported as `FACE_API_MODEL_FILES` from `facial-check/core`.

The files come from the `weights/` folder of the face-api.js repository (MIT license): https://github.com/justadudewhohacks/face-api.js/tree/master/weights. Use the files from that folder as they are. Each `*-weights_manifest.json` references its shard by file name, so keep both files of a model in the same directory and don't rename them.

## MediaPipeEngine (@mediapipe/tasks-vision)

| File | Where it goes | Option |
| --- | --- | --- |
| `face_landmarker.task` | e.g. `public/models/` | `modelAssetPath` (default `/models/face_landmarker.task`) |
| `vision_wasm_internal.js`, `vision_wasm_internal.wasm`, `vision_wasm_module_internal.js`, `vision_wasm_module_internal.wasm` | e.g. `public/mediapipe/wasm/` | `wasmBaseUrl` (default `/mediapipe/wasm`) |

- `face_landmarker.task` (about 3.6 MB, Apache 2.0 license) comes from Google's model storage: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- The wasm files are in `node_modules/@mediapipe/tasks-vision/wasm/`. Copy the whole folder and keep the file names. Copy it again whenever you upgrade `@mediapipe/tasks-vision`, because the wasm files must match the JS version.

The same list is exported as `MEDIAPIPE_MODEL_FILES` from `facial-check/core`.

## Serving the files

1. Copy the files into your app's static folder, for example `public/models/` in Vite, Next.js or Create React App.
2. Point the engine at that path:

   ```ts
   import { FaceApiEngine } from "facial-check/core";

   const engine = new FaceApiEngine({ modelBaseUrl: "/models" }); // default
   await engine.load();
   ```

`modelBaseUrl` can also be an absolute URL, such as a CDN. For a cross-origin URL, the server must send CORS headers that allow your app's origin. Serve the shards with a long cache lifetime: the files never change for a given face-api.js version.
