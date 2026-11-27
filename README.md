# facial-check

SDK for camera capture, face detection, facial analysis and Face Liveness flows. It has a framework-agnostic core and React bindings.

> **Status: 0.x, under construction.** This release only contains the project scaffolding. The public entry points exist but don't export anything yet. Each feature (camera, engines, analysis, challenges, PAD, session, React) ships in its own release. Full documentation comes with the first functional release.

## Installation

```bash
npm install facial-check
```

React and React DOM are **peer dependencies**. They are optional and only needed for `facial-check/react`, and the package never bundles them, so your app always uses its own copy. `face-api.js@0.22.2` and `@mediapipe/tasks-vision` are installed as regular dependencies.

## Entry points

| Import                   | Contents                                                    |
| ------------------------ | ----------------------------------------------------------- |
| `facial-check`           | Programmatic API (`FacialCheck`, public types)              |
| `facial-check/react`     | React components and hooks (`FaceLiveness`, `useFacialCheck`) |
| `facial-check/core`      | Building blocks (`FaceEngine`, `FaceAnalyzer`, …)           |
| `facial-check/detectors` | Standalone detectors (`BlinkDetector`, `MouthDetector`, …)  |

Each entry point is published as ESM (`.js` + `.d.ts`) and CommonJS (`.cjs` + `.d.cts`). Only these subpaths and `facial-check/package.json` can be imported. Internal modules are not part of the public API.

## Face engines

`facial-check/core` exposes the `FaceEngine` contract. An engine turns a `<video>`, `<img>` or `<canvas>` frame into `FaceDetectionResult`s. Each result has a normalized bounding box, a score, landmarks grouped by region (eyes, eyebrows, nose, mouth, jawline), and optional blendshapes and head pose. Coordinates go from 0 to 1 relative to the frame, and left/right always mean the subject's own sides. Engines don't depend on React or on the camera module.

```ts
import { FaceApiEngine } from "facial-check/core";

const engine = new FaceApiEngine({ modelBaseUrl: "/models", inputSize: 224, scoreThreshold: 0.5 });
await engine.load();
const [face] = await engine.detect(videoElement); // [] when no face is found or the video isn't ready
engine.dispose();
```

`FaceApiEngine` uses face-api.js 0.22.2 (TinyFaceDetector and the 68-point landmark net). It imports face-api.js only when `load()` runs. Errors are `FaceEngineError`s with a `code` of `MODEL_LOAD_FAILED`, `NOT_LOADED` or `DETECTION_FAILED`.

`MediaPipeEngine` is the complementary engine. It uses MediaPipe Tasks Vision `FaceLandmarker` in `VIDEO` mode and adds blendshapes (`eyeBlinkLeft`, `jawOpen`, `mouthSmileRight`, …) and head pose (`yaw`, `pitch` and `roll` in degrees) to each result. Its 478-point mesh is mapped to the same 68-point regions, so both engines feed the analysis the same way.

```ts
import { MediaPipeEngine } from "facial-check/core";

const engine = new MediaPipeEngine({
  wasmBaseUrl: "/mediapipe/wasm", // default
  modelAssetPath: "/models/face_landmarker.task", // default
  maxFps: 30, // video frames processed per second (default 30)
});
await engine.load();
const [face] = await engine.detect(videoElement);
face?.blendshapes?.eyeBlinkLeft; // 0..1
face?.pose?.yaw; // > 0 when the subject turns to their own right
```

For a `<video>`, `detect()` never runs the model twice on the same frame (`currentTime` unchanged) or faster than `maxFps`. In both cases it returns the last result. `<img>` and `<canvas>` inputs always run the model. The engine uses the GPU delegate and falls back to CPU when the GPU delegate can't be created. FaceLandmarker has no per-face confidence, so every returned face has `score: 1`. Faces below `minFacePresenceConfidence` are not returned.

### Model files

The model weights (and MediaPipe's wasm runtime) are not part of the npm package. Your app serves them, by default from `/models` (and `/mediapipe/wasm`). See [`models/README.md`](./models/README.md) for the list of files, where to get them, and how to serve them.

## Programmatic API

```ts
import { FacialCheck } from "facial-check";

const facialCheck = new FacialCheck({
  challenges: ["blink", "open-mouth", "turn-left", "turn-right"],
  randomChallenges: true,
  engine: "face-api", // or "mediapipe", or any FaceEngine
  video: document.querySelector("video")!, // optional: preview element
});

facialCheck.on("challengeStarted", ({ challenge }) => showInstruction(challenge.type));
facialCheck.on("progress", ({ percent }) => setProgress(percent));
facialCheck.on("completed", (result) => {
  result.challenges.passed; // presence challenges only
  result.pad?.status; // PAD verdict, when a padDetector is configured
});
facialCheck.on("error", ({ error, fatal }) => console.error(error.code, fatal));

await facialCheck.initialize(); // loads the engine models
await facialCheck.start(); // opens the camera; challenges start on the first face
facialCheck.stop(); // ends the session, releases the camera
facialCheck.destroy(); // releases camera, engine and listeners
```

Status: `idle` → `initializing` → `ready` → `starting` → `waiting-face` → `running` → (`analyzing-pad`) → `completed` | `failed`; also `stopped`, `error` and `destroyed`. Each `start()` runs a new `FacialSession` with its own id and timestamps.

Passing the challenges does not prove the face is real. Configure a `padDetector` (`PresentationAttackDetector`) for an anti-spoofing verdict; it is reported in `result.pad`, separately, and `NO_ATTACK_DETECTED` is not an absolute proof of authenticity.

## Privacy

All processing runs locally in the browser. By default, the SDK does not send images or video anywhere, does not store them, and does not log biometric data. Detecting facial movements does **not** prove that the user is a real person. Presence challenges are kept separate from Presentation Attack Detection (PAD).

## Development

Run all commands from the repository root:

```bash
npm install
npm run lint       # ESLint (typescript-eslint strict + react-hooks)
npm run typecheck  # tsc --noEmit (strict)
npm test           # Vitest (jsdom)
npm run build      # tsup → dist/ (ESM + CJS + .d.ts/.d.cts)
npm run check      # all of the above
```

Source layout:

```text
src/
  core/        session, config, event emitter
  camera/      MediaDevices capture
  engines/     FaceEngine contract + face-api.js / MediaPipe engines
  analysis/    face, eye, mouth and head-pose analysis
  detectors/   public `facial-check/detectors` barrel
  challenges/  liveness challenge engine
  pad/         Presentation Attack Detection contracts
  react/       components and hooks/
  types/       public types
models/        model weights (see engine docs)
examples/react demo app
tests/         Vitest suites
```

## Versioning and publishing

This package follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: breaking changes to the public API, meaning anything exported from the four entry points or the shape of results and events.
- **MINOR**: new features that stay backwards compatible, such as new challenges, engines, detectors or options.
- **PATCH**: backwards-compatible bug fixes.

While the version is `0.x`, a MINOR bump may include breaking changes, and the CHANGELOG calls them out. Every release adds an entry to [`CHANGELOG.md`](./CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/) format).

To publish (maintainers):

```bash
npm version <patch|minor|major>   # bumps package.json and tags
npm publish                       # prepublishOnly runs lint, typecheck, test and build
```

`publishConfig` publishes to the public npm registry with `access: public`.

## License

MIT. See [LICENSE](./LICENSE).
