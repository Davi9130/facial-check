# facial-check

SDK for camera capture, face detection, facial analysis and Face Liveness flows in the browser. It has a framework-agnostic core and React bindings. Everything runs locally: frames never leave the device unless you plug in a provider that sends them.

- **Camera**: front-camera capture with standard errors and guaranteed release of the tracks.
- **Two face engines**: [face-api.js 0.22.2](https://github.com/justadudewhohacks/face-api.js) (default) and [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (blendshapes and head pose), behind one `FaceEngine` contract.
- **Facial analysis**: face presence, position, distance, stability, eyes (EAR), mouth (MAR) and head pose.
- **Movement detectors**: blink, open mouth, smile, head turn and tilt. They are temporal, smoothed and confidence-scored, and you can use each one on its own.
- **Liveness challenges**: random sequence per session, with timeouts, retries and progress.
- **Sessions and events**: one programmatic API (`FacialCheck`) with typed events.
- **PAD interface**: plug in any Presentation Attack Detection provider. Its verdict is kept apart from the challenges.
- **React**: a ready-made `<FaceLiveness>` flow, building-block components and headless hooks.

> **Liveness challenges are not anti-spoofing.** Completing the movements shows that *something in front of the camera follows instructions*. It does not prove that a live person is there: a replayed video, a deepfake or a mask can pass. Protection against presentation attacks needs a real PAD provider. See [Limitations](#limitations) and [Security and privacy](#security-and-privacy).

## Contents

- [Installation](#installation)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Loading the models](#loading-the-models)
- [Configuration](#configuration)
- [Programmatic API](#programmatic-api)
- [React API](#react-api)
- [Headless API (hooks)](#headless-api-hooks)
- [Available challenges](#available-challenges)
- [Events](#events)
- [Building blocks](#building-blocks-facial-checkcore-and-facial-checkdetectors)
- [Presentation Attack Detection (PAD)](#presentation-attack-detection-pad)
- [Errors](#errors)
- [Examples](#examples)
- [Limitations](#limitations)
- [Security and privacy](#security-and-privacy)
- [Licenses of models and dependencies](#licenses-of-models-and-dependencies)
- [Development](#development)
- [Versioning and publishing](#versioning-and-publishing)

## Installation

```bash
npm install facial-check
```

`face-api.js@0.22.2` and `@mediapipe/tasks-vision` are installed as regular dependencies. React and React DOM (>= 18) are **optional peer dependencies**. You only need them for `facial-check/react`. The package never bundles React, so your app always uses its own copy.

| Import                   | Contents                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `facial-check`           | Programmatic API (`FacialCheck`, `FacialSession`, camera, analysis, challenges, PAD, public types) |
| `facial-check/react`     | React components (`FaceLiveness`, …) and hooks (`useFacialCheck`, …)      |
| `facial-check/core`      | Building blocks: engines (`FaceEngine`, `FaceApiEngine`, `MediaPipeEngine`), `FaceAnalyzer`, `EventEmitter`, everything in `facial-check` |
| `facial-check/detectors` | Standalone detectors (`BlinkDetector`, `MouthDetector`, `SmileDetector`, `HeadPoseDetector`) |

Each entry point ships as ESM (`.js` + `.d.ts`) and CommonJS (`.cjs` + `.d.cts`), targets ES2022 and has `sideEffects: false`. Only these subpaths and `facial-check/package.json` can be imported. Internal modules are not part of the public API.

## Requirements

- **Secure context.** Browsers only allow camera access (`getUserMedia`) over **HTTPS** or on `http://localhost`. On plain HTTP the SDK fails with the camera error `INSECURE_CONTEXT`.
- **Browser.** Use a current browser with `MediaDevices.getUserMedia`, Canvas, WebGL and WebAssembly. Supported targets are current Chrome, Edge, Firefox and Safari on desktop, plus Chrome on Android and Safari on iOS 15 and later. The build targets ES2022, so very old browsers are not supported.
  - iOS Safari needs the `<video>` to be `muted` and `playsInline`. The SDK's own video elements and `<FaceCamera>` already set both.
  - MediaPipe uses the GPU delegate and falls back to CPU when WebGL2 is unavailable.
- **Camera.** A front (user-facing) camera is preferred. Any camera works when `fallbackToAnyCamera` is on, which is the default.
- **Runtime.** This is a browser SDK. Under Node or SSR (for example Next.js server components), it can be imported but not run: create `FacialCheck` and render `<FaceLiveness>` on the client only, for example with `"use client"` or a dynamic import with `ssr: false`.
- **Model files** served by your app. See [Loading the models](#loading-the-models).

## Quick start

React:

```tsx
import { FaceLiveness } from "facial-check/react";

export function Onboarding() {
  return (
    <FaceLiveness
      challenges={["blink", "open-mouth", "turn-left", "turn-right"]}
      randomChallenges
      onSuccess={(result) => {
        console.log("Challenges passed:", result.challenges.passed);
      }}
      onError={(error) => {
        console.error(error.code, error.message);
      }}
    />
  );
}
```

Without React:

```ts
import { FacialCheck } from "facial-check";

const facialCheck = new FacialCheck({
  challenges: ["blink", "open-mouth", "turn-left", "turn-right"],
  randomChallenges: true,
});

facialCheck.on("completed", (result) => console.log(result.challenges.passed));

await facialCheck.initialize(); // loads the models
await facialCheck.start(); // opens the camera and runs the challenges
```

Both expect the model files under `/models`, as described in the next section.

## Loading the models

The npm package does **not** include model weights. Your app serves them as static files, and the engines download them at runtime from the URL you configure. Only the weight files are fetched. Frames are never uploaded.

### face-api.js (default engine)

Copy these files from the [`weights/` folder of face-api.js](https://github.com/justadudewhohacks/face-api.js/tree/master/weights) (MIT) into, for example, `public/models/`:

| File | Needed when |
| --- | --- |
| `tiny_face_detector_model-weights_manifest.json`, `tiny_face_detector_model-shard1` | always (~190 KB) |
| `face_landmark_68_model-weights_manifest.json`, `face_landmark_68_model-shard1` | `landmarkModel: "full"`, the default (~350 KB) |
| `face_landmark_68_tiny_model-weights_manifest.json`, `face_landmark_68_tiny_model-shard1` | `landmarkModel: "tiny"` (~80 KB) |

Keep the file names as they are: each manifest references its shard by name.

```ts
new FacialCheck({ faceApi: { modelBaseUrl: "/models" } }); // "/models" is the default
```

### MediaPipe (complementary engine)

| File | Where | Option |
| --- | --- | --- |
| [`face_landmarker.task`](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) (~3.6 MB, Apache 2.0) | e.g. `public/models/` | `modelAssetPath` (default `/models/face_landmarker.task`) |
| everything in `node_modules/@mediapipe/tasks-vision/wasm/` | e.g. `public/mediapipe/wasm/` | `wasmBaseUrl` (default `/mediapipe/wasm`) |

Copy the wasm folder again whenever you upgrade `@mediapipe/tasks-vision`, because the wasm must match the JS version.

```ts
new FacialCheck({
  engine: "mediapipe",
  mediapipe: { modelAssetPath: "/models/face_landmarker.task", wasmBaseUrl: "/mediapipe/wasm" },
});
```

Both lists are exported as `FACE_API_MODEL_FILES` and `MEDIAPIPE_MODEL_FILES` from `facial-check/core`, which helps when you write a copy script. The example app has one: `examples/react/scripts/setup-models.mjs`. URLs can be absolute (for example a CDN). A cross-origin URL needs CORS headers that allow your origin. The files never change for a given version, so serve them with a long cache lifetime.

Models load when `initialize()` runs, or on the first `start()`. For face-api.js, the library itself is imported lazily at that point too.

## Configuration

Every option is optional. `FacialCheck`, `useFacialCheck` and `<FaceLiveness>` take the same `FacialCheckConfig`.

| Option | Default | Description |
| --- | --- | --- |
| `challenges` | all six | Challenges to choose from (see [Available challenges](#available-challenges)). |
| `randomChallenges` | `true` | Shuffle the order in every session. The same sequence never repeats twice in a row. |
| `count` | all of `challenges` | How many challenges each session runs. |
| `timeoutMs` | `8000` | Time allowed for each attempt. |
| `maxAttempts` | `2` | Attempts per challenge before it fails. |
| `maxFaceLostMs` | `1500` | Longest time without a face before the attempt fails with `face-lost`. |
| `challengeSettings` | — | Per-challenge overrides of `timeoutMs`, `maxAttempts` and `maxFaceLostMs`, e.g. `{ blink: { timeoutMs: 5000 } }`. |
| `detectors` | — | Thresholds of the movement detectors (`blink`, `mouth`, `smile`, `headPose`). |
| `engine` | `"face-api"` | `"face-api"`, `"mediapipe"`, or any `FaceEngine` instance. |
| `faceApi` | — | `FaceApiEngine` options: `modelBaseUrl`, `inputSize`, `scoreThreshold`, `landmarkModel` (`"full"` or `"tiny"`), `maxFaces`. |
| `mediapipe` | — | `MediaPipeEngine` options: `wasmBaseUrl`, `modelAssetPath`, `delegate`, `maxFaces`, `maxFps`, confidence thresholds. |
| `camera` | front camera, 640×480, 30 fps | `CameraOptions` (`facingMode`, `resolution`, `frameRate`, `maxFrameRate`, `deviceId`, `fallbackToAnyCamera`), or a `CameraManager` instance you share. |
| `video` | off-screen element | `<video>` that shows the preview and that the engine reads. Can also be set with `attachVideo()`. |
| `analyzer` | — | `FaceAnalyzer` options (guide position and tolerance, `minFaceSize`, `maxFaceSize`, stability), or a custom analyzer. |
| `padDetector` | none | A `PresentationAttackDetector` (see [PAD](#presentation-attack-detection-pad)). |
| `pad` | `{ maxFrames: 3 }` | Most in-memory frames captured for the PAD per session, and `timeoutMs`. |
| `maxFps` | `15` | Upper bound on processed frames per second. |
| `maxDetectionErrors` | `5` | Consecutive failed detections before the session ends with `ENGINE_ERROR`. |
| `now`, `random`, `createSessionId`, `scheduler` | `Date.now`, `Math.random`, `crypto.randomUUID`, `requestAnimationFrame` | Injectable clock, random source, id generator and frame scheduler, mostly for tests. |

`FacialCheck` throws `FacialCheckError` with `INVALID_CONFIG` for invalid values.

## Programmatic API

```ts
import { FacialCheck } from "facial-check";

const facialCheck = new FacialCheck({
  challenges: ["blink", "open-mouth", "turn-left", "turn-right"],
  randomChallenges: true,
  engine: "face-api", // or "mediapipe", or any FaceEngine
  video: document.querySelector("video")!, // optional preview element
});

facialCheck.on("faceDetected", ({ detected, ready, issues }) => updateGuide(detected, ready, issues));
facialCheck.on("challengeStarted", ({ challenge }) => showInstruction(challenge.type));
facialCheck.on("progress", ({ percent }) => setProgress(percent));
facialCheck.on("completed", (result) => {
  result.challenges.passed; // presence challenges only
  result.pad?.status; // PAD verdict, when a padDetector is configured
});
facialCheck.on("error", ({ error, fatal }) => console.error(error.code, fatal));

await facialCheck.initialize(); // loads the engine models
await facialCheck.start(); // opens the camera; challenges start on the first face
```

| Method | Description |
| --- | --- |
| `initialize(): Promise<void>` | Loads the engine. It is idempotent, and `start()` calls it when needed. |
| `start(): Promise<void>` | Starts a new session: opens the camera, waits for a face, then runs the challenges. Each call creates a new `FacialSession` with its own id and timestamps. |
| `stop(): void` | Ends the running session and releases the camera. |
| `destroy(): void` | Releases the camera, the engine and every listener. The instance can't be used again. |
| `getStatus(): FacialCheckStatus` | Current status. |
| `getResults(): FacialCheckResult` | Result of the current or last session. |
| `attachVideo(video)` | Sets the preview `<video>`. |
| `on` / `once` / `off` | Typed event subscription (see [Events](#events)). `on` returns an unsubscribe function. |

**Status lifecycle:** `idle` → `initializing` → `ready` → `starting` → `waiting-face` → `running` → (`analyzing-pad`) → `completed` | `failed`. `stop()` leads to `stopped`, and an unrecoverable problem leads to `error`. A new session can start from `ready`, `completed`, `failed`, `stopped` and `error`. `destroy()` leads to `destroyed`, which is final.

**Result (`FacialCheckResult`):**

```ts
{
  sessionId: string;
  status: FacialCheckStatus;
  engine: string; // "face-api" | "mediapipe" | custom engine name
  startedAt: number | null; // epoch ms
  challengesStartedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  challenges: {
    passed: boolean; // every challenge completed; NOT an anti-spoofing verdict
    status: "idle" | "running" | "passed" | "failed" | "stopped";
    challenges: ChallengeState[]; // type, status, attempts, failureReason, evidence…
  };
  pad: PadAnalysis | null; // independent verdict; null without a padDetector
  error: { code; message } | null;
}
```

The `evidence` of a completed challenge holds only timing and confidence (detector, direction, confidence, duration, frame count). It contains no image, landmark or biometric measurement.

## React API

```tsx
import { FaceLiveness } from "facial-check/react";

<FaceLiveness
  challenges={["blink", "open-mouth", "turn-left", "turn-right"]}
  randomChallenges
  engine="mediapipe"
  mediapipe={{ modelAssetPath: "/models/face_landmarker.task" }}
  onSuccess={(result) => sendToBackend(result.sessionId, result.pad?.status)}
  onFailure={(result) => console.warn("challenge failed", result.challenges)}
  onError={(error) => console.error(error.code)}
/>;
```

`<FaceLiveness>` is the complete flow. It shows the camera preview, a face frame, dynamic instructions (move closer, center your face, blink…), a progress bar, feedback after each challenge, and the start, loading, success, failure and error screens. The root element exposes the current screen as `data-phase` (`start`, `loading`, `capture`, `analyzing`, `success`, `failure`, `error`).

Props are every `FacialCheckConfig` option, every `useFacialCheck` callback (`onSuccess`, `onFailure`, `onCompleted`, `onError`, `onProgress`, `onChallengeStarted`, `onChallengeCompleted`, `onChallengeFailed`, `onFaceDetected`, `onFrame`, `onStatusChange`), `autoInitialize` and `autoStart`, plus:

| Prop | Default | Description |
| --- | --- | --- |
| `texts` | pt-BR | Partial `LivenessTexts` to translate or reword any text (`DEFAULT_TEXTS` shows every key). |
| `mirrored` | `true` | Mirror the preview (selfie view). |
| `showProgress` | `true` | Show the progress bar. |
| `feedbackMs` | `900` | How long the per-challenge feedback stays visible. |
| `className`, `style`, `classNames` | — | Classes for the root and the inner parts (`camera`, `guide`, `instructions`, `progress`, `overlay`, `actions`, `button`). |
| `unstyled` | `false` | Drop all default inline styles and style everything yourself. |
| `renderStart`, `renderLoading`, `renderSuccess`, `renderFailure`, `renderError` | — | Replace the content of each screen. |
| `children` | — | Render prop drawn over the camera, for example a custom guide. |

**Theming.** The default styles read CSS custom properties: `--fc-primary`, `--fc-success`, `--fc-warning`, `--fc-error`, `--fc-text`, `--fc-muted`, `--fc-background`, `--fc-track`, `--fc-overlay`, `--fc-radius`, `--fc-max-width` and `--fc-font`.

```css
.my-liveness { --fc-primary: #7c3aed; --fc-radius: 24px; }
```

**Translation.**

```tsx
<FaceLiveness texts={{ start: "Start", challenges: { blink: "Blink your eyes" } }} />
```

The configuration (challenges, engine, camera…) is read when the component mounts. To apply a new one, change the component's `key`. Callbacks can change freely.

**Building-block components**, for your own layout: `FaceCamera` (the `<video>` preview), `FaceGuide` (the face frame, with states `idle`, `searching`, `adjust`, `ready`, `success` and `error`), `ChallengeInstructions` (with `getInstruction()` for the text alone), and `LivenessProgress`. Helpers: `getErrorMessage(error, texts)` and `isPermissionDenied(error)`.

## Headless API (hooks)

Hooks give you the state and actions, and you build the interface.

```tsx
import { useFacialCheck } from "facial-check/react";

function CustomLiveness() {
  const { status, faceDetected, faceIssues, currentChallenge, progress, result, error, videoRef, start, stop } =
    useFacialCheck({ challenges: ["blink", "smile", "turn-left"], randomChallenges: true });

  return (
    <div>
      <video ref={videoRef} autoPlay muted playsInline />
      <p>{status}</p>
      <p>{currentChallenge}</p>
      <p>{progress}%</p>
      <button onClick={() => void start()}>Iniciar</button>
      <button onClick={stop}>Parar</button>
    </div>
  );
}
```

| Hook | What it does | Returns |
| --- | --- | --- |
| `useFacialCheck(options)` | Full flow: camera, engine, challenges and session (a `FacialCheck` per component). | `status`, `sessionId`, `faceDetected`, `faceReady`, `faceIssues`, `currentChallenge`, `challenge`, `progress` (0–100), `progressDetails`, `result`, `error`, `facialCheck`, `videoRef`, `initialize()`, `start()`, `stop()` |
| `useFaceCamera(options)` | Camera only (`CameraManager`). | `status`, `isActive`, `stream`, `settings`, `error`, `videoRef`, `start()`, `stop()`, `captureFrame()`, `checkPermission()` |
| `useFaceDetection(options)` | Engine + analyzer loop on a video. | `status`, `faces`, `analysis`, `faceDetected`, `error`, `engine`, `videoRef`, `start()`, `stop()` |
| `useLivenessChallenges(options)` | Challenge engine only; you feed it frames with `update(analysis, timestamp)`. | `status`, `sessionId`, `currentChallenge`, `challenge`, `challenges`, `progress`, `result`, `error`, `start()`, `update()`, `stop()`, `reset()` |

Hook behavior:

- Each hook creates its resources once per mounted component, including under React StrictMode's double mount.
- Each hook releases the camera, the engine and its listeners on unmount.
- `start()` and `initialize()` never reject. Failures go to `error` and `onError`.
- `onFrame` / `onResult` run on every frame without re-rendering the component. State only changes when a value changes.

## Available challenges

| Id | Asks the user to | Validated by |
| --- | --- | --- |
| `blink` | Blink | `BlinkDetector`: eye aspect ratio (EAR), or the `eyeBlink*` blendshapes with MediaPipe; open → closed → open within a time limit |
| `open-mouth` | Open the mouth | `MouthDetector`: mouth aspect ratio (MAR), or `jawOpen` |
| `smile` | Smile | `SmileDetector`: mouth width relative to the eyes, or the `mouthSmile*` blendshapes |
| `turn-left` | Turn the head to their own left | `HeadPoseDetector` (yaw) |
| `turn-right` | Turn the head to their own right | `HeadPoseDetector` (yaw) |
| `head-tilt` | Tilt the head | `HeadPoseDetector` (roll) |

A challenge only advances when its detector confirms the movement. The detectors smooth the signal with an EMA and use hysteresis thresholds. They also need a neutral face first and at least 2 frames past the threshold, so one noisy frame never passes a challenge. Every challenge has its own state: `pending` → `active` → `completed` | `failed` | `timeout`, plus `attempts`, `failureReason` (`timeout`, `face-lost`, `aborted`) and `evidence`. Left and right always mean the **subject's own** sides, whatever the preview mirroring.

## Events

Subscribe with `facialCheck.on(name, listener)`, or through the matching `on…` callback of the React hook or component.

| Event | Payload | When |
| --- | --- | --- |
| `statusChange` | `{ status, previous }` | Every status transition. |
| `faceDetected` | `{ sessionId, detected, ready, faceCount, issues, timestamp }` | The face appears or disappears. Emitted on change only. |
| `frame` | `FaceAnalysis` | Every processed frame: position, size, stability, eyes, mouth, head pose and `issues`. |
| `challengeStarted` | `{ sessionId, challenge }` | A challenge (or a new attempt) starts. |
| `challengeCompleted` | `{ sessionId, challenge }` | The detector confirmed the movement. |
| `challengeFailed` | `{ sessionId, challenge, reason, attempt, willRetry }` | An attempt failed. |
| `progress` | `{ sessionId, completed, total, current, currentIndex, challengeProgress, percent }` | Progress changed. `percent` goes from 0 to 100. |
| `completed` | `FacialCheckResult` | The session ended on its own (`completed` or `failed`), PAD included. |
| `error` | `{ sessionId, error, fatal }` | An error happened. `fatal: true` means it ended the session. |

Face issues (`FaceAnalysisIssue`): `no-face`, `multiple-faces`, `not-centered`, `too-close`, `too-far`, `partially-visible`, `unstable`.

## Building blocks (`facial-check/core` and `facial-check/detectors`)

Every layer works on its own and has no dependency on React.

```ts
import { CameraManager, FaceApiEngine, FaceAnalyzer, ChallengeManager } from "facial-check/core";
import { BlinkDetector } from "facial-check/detectors";

const camera = new CameraManager({ facingMode: "user", resolution: { width: 640, height: 480 } });
await camera.start();
await camera.attach(video);

const engine = new FaceApiEngine({ modelBaseUrl: "/models" });
await engine.load();

const analyzer = new FaceAnalyzer();
const blink = new BlinkDetector();

async function loop() {
  const faces = await engine.detect(video); // FaceDetectionResult[] (normalized box, landmarks, blendshapes?, pose?)
  const analysis = analyzer.analyze(faces, performance.now());
  const { event } = blink.update(analysis, analysis.timestamp);
  if (event) console.log("blink", event.confidence);
  requestAnimationFrame(loop);
}
loop();

// later
camera.stop();
engine.dispose();
```

- **`FaceEngine`** is the contract for engines: `load()`, `detect(input)` and `dispose()`. To add another engine, implement it and pass the instance as `engine`. Results use normalized coordinates (0–1), landmarks grouped by region (eyes, eyebrows, nose, mouth, jawline), and optional `blendshapes` and `pose` (`yaw`, `pitch` and `roll` in degrees).
- **`MediaPipeEngine`** maps its 478-point mesh to the same 68-point regions, so both engines feed the analysis the same way. It never processes the same video frame twice, and its rate is limited by `maxFps`.
- **`FaceAnalyzer`** combines `EyeAnalyzer`, `MouthAnalyzer` and `HeadPoseAnalyzer`, which you can also use separately.
- **Detectors** accept either a `FaceAnalysis` or a raw `FaceDetectionResult`, and expose `update()`, `reset()` and `count`.
- **`ChallengeManager`** is driven by frames and uses no timers. Feed it with `update(input, timestamp)`.
- **`EventEmitter`** is a small typed event emitter.

## Presentation Attack Detection (PAD)

PAD is a separate layer from the challenges. Implement a `PadProvider` (a local model, a vendor SDK or a remote service) and register it in a `PresentationAttackDetector`:

```ts
import { FacialCheck, PresentationAttackDetector, type PadProvider } from "facial-check";

const vendor: PadProvider = {
  name: "my-vendor",
  async analyze({ frames }, { signal }) {
    const verdict = await myVendorSdk.check(frames, { signal }); // your integration
    return { provider: "my-vendor", status: verdict, score: 0.12, timestamp: Date.now() };
  },
};

const facialCheck = new FacialCheck({
  padDetector: new PresentationAttackDetector({ providers: [vendor], timeoutMs: 10_000 }),
  pad: { maxFrames: 3 },
});
```

- After the challenges, the session captures up to `pad.maxFrames` frames **in memory** (one per completed challenge), runs the PAD on them and drops them right after. The verdict goes to `result.pad`, apart from `result.challenges`.
- Statuses: `NO_ATTACK_DETECTED`, `PRESENTATION_ATTACK` and `INCONCLUSIVE`.
- **The detector fails safe.** A provider error, a timeout, a cancellation, an invalid answer or having no provider all become `INCONCLUSIVE`, never `NO_ATTACK_DETECTED`. With several providers, the `strict` policy applies: any attack wins, then any inconclusive result.
- **`NO_ATTACK_DETECTED` is not an absolute proof of authenticity.** It only means the providers found no attack in the evidence they received.
- `NoopPadProvider` is a placeholder that always answers `INCONCLUSIVE` (`NOT_IMPLEMENTED`).
- `PresentationAttackDetector` keeps a bounded in-memory history of results (`getHistory()`, `maxHistory`, 20 by default). The history holds results only, never frames.

The SDK ships the contract, not an anti-spoofing model. For real protection, use a provider evaluated under ISO/IEC 30107-3.

## Errors

| Class | Codes |
| --- | --- |
| `FacialCheckError` (`isFacialCheckError`) | `CAMERA_ERROR`, `ENGINE_ERROR`, `PAD_ERROR`, `INVALID_CONFIG`, `INVALID_STATE`, `DESTROYED`, `UNKNOWN` |
| `CameraError` (`isCameraError`), in `cause` of `CAMERA_ERROR` | `PERMISSION_DENIED`, `NOT_FOUND`, `NOT_READABLE`, `OVERCONSTRAINED`, `INSECURE_CONTEXT`, `NOT_SUPPORTED`, `UNKNOWN` |
| `FaceEngineError` (`isFaceEngineError`), in `cause` of `ENGINE_ERROR` | `MODEL_LOAD_FAILED`, `NOT_LOADED`, `DETECTION_FAILED` |

A `PAD_ERROR` keeps the challenge verdict and sets `pad` to `null`. In React, `isPermissionDenied(error)` tells you when to show "allow camera access" guidance.

## Examples

[`examples/react`](https://github.com/Davi9130/facial-check/tree/main/examples/react) is a Vite + React demo that uses only the public entry points. It has six examples, and each one works with both engines:

| Example | APIs |
| --- | --- |
| Basic detection (box and per-frame metrics) | `useFaceCamera`, `useFaceDetection`, `FaceCamera` |
| Face capture (photo only when the face is ready) | `useFaceCamera().captureFrame`, `useFaceDetection`, `FaceGuide` |
| Challenges | `useLivenessChallenges`, `useFaceDetection`, `LivenessProgress` |
| Full liveness | `FaceLiveness` |
| Headless | `useFacialCheck` |
| PAD integration (fake provider) | `PresentationAttackDetector`, `PadProvider`, `padDetector` |

```bash
npm install && npm run build      # at the repository root
cd examples/react
npm install
npm run setup                     # downloads/copies the models into public/
npm run dev                       # http://localhost:5173
```

## Limitations

- **Challenges prove responsiveness, not liveness.** A replayed video, a deepfake, a 3D mask or someone holding a photo and moving it can pass the movement challenges. Random order and timeouts make simple replays harder, but they don't stop them. The SDK has no built-in anti-spoofing model, so PAD depends on the provider you plug in.
- **Not an identity check.** The SDK doesn't compare faces, doesn't recognize anyone and doesn't produce face templates. Face detection is separate from authentication: matching a face to a document or an account is your backend's job.
- **The client can be tampered with.** All logic runs in the browser, so an attacker can change the code, inject a virtual camera or forge results. Never treat `result.challenges.passed` alone as an authorization decision. Validate on your server, ideally with a server-side PAD.
- **Accuracy depends on conditions.** Low light, backlight, tinted glasses, occlusion, low-end cameras and extreme angles hurt detection, especially for blinks with the `tiny` landmark model. The thresholds are heuristics and are not calibrated for any population. Measure pass rates across groups of users before production. `tests/scenarios/README.md` has a manual evaluation plan (BPCER and APCER per attack type).
- **Performance.** face-api.js runs on TensorFlow.js 1.7 with WebGL. MediaPipe runs on wasm with the GPU delegate. On low-end phones, lower `maxFps`, use `landmarkModel: "tiny"`, or use the MediaPipe engine.
- **face-api.js 0.22.2 is no longer maintained** (its last release was in 2020). It is the default for compatibility. MediaPipe is the complementary, actively maintained engine.
- **Browser only.** No Node or SSR execution, no React Native.

## Security and privacy

What the SDK does by default:

- **Local processing.** Detection, analysis, challenges and PAD orchestration run in the browser. The only network requests are for the model and wasm files you serve.
- **No upload and no storage.** The SDK never sends images or video anywhere, never records video, and never writes frames to `localStorage`, IndexedDB, cookies or the console. The PAD frames stay in memory for the duration of the analysis and are then dropped.
- **No biometric data in logs or results.** The SDK writes nothing to the console. Results and events carry statuses, timestamps, counts and confidences. Challenge evidence contains no images, landmarks or measurements.
- **The camera is released** when the session ends (completed, failed or stopped), on `destroy()`, and when React components or hooks unmount. If the camera stops on its own (unplugged or permission revoked), the session reports `CAMERA_ERROR`.
- **Permissions are handled.** Denied, missing, busy and insecure-context cases each have their own `CameraError` code, and `checkPermission()` reads the Permissions API when the browser supports it.

What stays your responsibility, as the controller of the data:

- **LGPD and biometric data.** Under the Brazilian LGPD (Lei 13.709/2018, art. 5 II and art. 11), biometric data is *sensitive personal data*. It needs a specific legal basis, usually the data subject's specific and prominent consent, plus purpose limitation and data minimization. Similar rules apply under the GDPR (art. 9) and other laws. Show a clear notice before you open the camera: what is processed, why, for how long, and who receives it.
- **Image retention and processing.** By default, frames exist only in memory while they are processed. Nothing is retained. If your app keeps a capture (for example from `captureFrame()`) or uses a `PadProvider` that sends frames to a server, your app is collecting biometric data. Get consent first, encrypt it in transit and at rest, set a retention period and delete the data when it ends, and record it in your privacy notice and in the data protection impact assessment (RIPD/DPIA).
- **Third-party providers.** A remote PAD provider is a data processor. Check its contract, where it stores data, and its certifications.
- **Server-side checks.** Treat everything reported by the client as untrusted input. Bind `sessionId` to your own session, check timestamps, and apply rate limits.
- **Content Security Policy.** If you use a CSP, allow `'wasm-unsafe-eval'` for MediaPipe, allow `blob:` workers if your bundler needs them, and allow `connect-src` and `script-src` to the origin of your models.

Don't present the SDK to your users as fraud protection unless you have an adequate PAD mechanism in place.

## Licenses of models and dependencies

| Component | Used for | License |
| --- | --- | --- |
| `facial-check` (this package) | — | MIT |
| [`face-api.js`](https://github.com/justadudewhohacks/face-api.js) 0.22.2 | default engine | MIT |
| `@tensorflow/tfjs-core` 1.7.0 (a dependency of face-api.js) | face-api.js runtime | Apache 2.0 |
| `tslib`, `seedrandom`, `node-fetch` (dependencies of face-api.js / tfjs-core) | runtime helpers | 0BSD, MIT, MIT |
| [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.2.3 (JS and wasm) | MediaPipe engine | Apache 2.0 |
| face-api.js weights (`tiny_face_detector`, `face_landmark_68`, `face_landmark_68_tiny`) | models you serve | MIT (face-api.js repository) |
| MediaPipe `face_landmarker.task` | model you serve | Apache 2.0 (model cards linked from the [Face Landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)) |
| `react`, `react-dom` | optional peer dependencies, not bundled | MIT |

The model files are not part of the npm package. When you serve them, keep their license notices, and for Apache 2.0 components keep the NOTICE files of the original distributions. Read the model cards for intended use and known biases.

## Development

Run all commands from the repository root (Node 18+; CI uses Node 22 and 24):

```bash
npm install
npm run lint           # ESLint (typescript-eslint strict + react-hooks)
npm run typecheck      # tsc --noEmit (strict)
npm test               # Vitest (jsdom), unit and integration
npm run test:coverage  # with coverage thresholds
npm run bench          # performance benchmarks
npm run build          # tsup → dist/ (ESM + CJS + .d.ts/.d.cts)
npm run check:exports  # publint + arethetypeswrong on the packed tarball
npm run check          # all of the above except bench
```

```text
src/
  core/        FacialCheck, FacialSession, config, errors, event emitter
  camera/      MediaDevices capture
  engines/     FaceEngine contract + face-api.js / MediaPipe engines
  analysis/    face, eye, mouth and head-pose analysis
  detectors/   movement detectors (`facial-check/detectors`)
  challenges/  liveness challenge engine
  pad/         Presentation Attack Detection contracts
  react/       components and hooks/
  types/       public types
models/        how to get and serve the model files
examples/react demo app
tests/         Vitest suites + manual evaluation scenarios (tests/scenarios)
bench/         benchmarks
```

## Versioning and publishing

This package follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: breaking changes to the public API, meaning anything exported from the four entry points, or the shape of results and events.
- **MINOR**: new features that stay backwards compatible, such as new challenges, engines, detectors or options.
- **PATCH**: backwards-compatible bug fixes.

While the version is `0.x`, a MINOR bump may include breaking changes, and the CHANGELOG calls them out. Every release adds an entry to [`CHANGELOG.md`](https://github.com/Davi9130/facial-check/blob/main/CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/) format).

The published tarball contains only `dist/`, `README.md`, `LICENSE` and `package.json`. To publish (maintainers):

```bash
npm pack --dry-run                # review the tarball contents
npm publish --dry-run             # full rehearsal (runs prepublishOnly)
npm version <patch|minor|major>   # bumps package.json and tags (skip for the first 0.1.0 release)
npm publish                       # prepublishOnly runs `npm run check`
```

`publishConfig` publishes to the public npm registry with `access: public`.

## License

MIT. See [LICENSE](./LICENSE).
