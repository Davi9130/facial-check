# Changelog

All notable changes to `facial-check` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While in `0.x`, minor releases may contain breaking changes; they are called out explicitly.

## [Unreleased]

## [0.1.0] - 2026-11-27

First public release.

### Added

#### Package

- Public entry points `facial-check`, `facial-check/react`, `facial-check/core` and `facial-check/detectors`, each published as ESM and CommonJS with type declarations (`.d.ts` / `.d.cts`). The package targets ES2022 and is marked `sideEffects: false`.
- `face-api.js@0.22.2` and `@mediapipe/tasks-vision` are regular dependencies. React and React DOM (>= 18) are optional peer dependencies and are never bundled.
- The npm tarball contains only `dist/`, `README.md` and `LICENSE`. `prepublishOnly` runs lint, typecheck, tests with coverage, build, and the export checks (publint and arethetypeswrong).

#### Camera

- `CameraManager`: `getUserMedia` capture that prefers the front camera, with configurable resolution and FPS, a specific `deviceId`, and fallback to any camera. It can check permissions through the Permissions API, attach to a `<video>` (muted, inline) and capture frames. It always stops its tracks and reports when the camera ends on its own.
- `CameraError` with standard codes: `PERMISSION_DENIED`, `NOT_FOUND`, `NOT_READABLE`, `OVERCONSTRAINED`, `INSECURE_CONTEXT`, `NOT_SUPPORTED`, `UNKNOWN`.

#### Engines

- `FaceEngine` contract and engine-agnostic result types (`FaceDetectionResult`): a normalized box, landmarks grouped by region, and optional blendshapes and head pose. Exported from `facial-check/core`.
- `FaceApiEngine`: face-api.js 0.22.2 engine (TinyFaceDetector, plus the full or tiny 68-point landmarks). The model URL is configurable, the library loads lazily, and each instance has its own networks.
- `MediaPipeEngine`: MediaPipe Tasks Vision `FaceLandmarker` engine in `VIDEO` mode. It adds blendshapes and head pose (yaw, pitch and roll from the transformation matrix) and maps the mesh to the 68-point regions. The wasm and model paths are configurable. It has a `maxFps` limit, never reprocesses the same video frame, and falls back from GPU to CPU.
- `FaceEngineError` with codes `MODEL_LOAD_FAILED`, `NOT_LOADED` and `DETECTION_FAILED`. `FACE_API_MODEL_FILES` and `MEDIAPIPE_MODEL_FILES` list the model files.

#### Analysis and detectors

- `FaceAnalyzer`, `EyeAnalyzer`, `MouthAnalyzer` and `HeadPoseAnalyzer` cover face presence, position against a guide, distance, visibility, temporal stability, eye openness (EAR), mouth openness (MAR), smile score and head pose. They report the issues `no-face`, `multiple-faces`, `not-centered`, `too-close`, `too-far`, `partially-visible` and `unstable`.
- Movement detectors in `facial-check/detectors`:
  - `BlinkDetector` uses EAR or eye openness, and needs open → closed → open within `maxClosedMs`.
  - `MouthDetector` uses MAR or `jawOpen`.
  - `SmileDetector` uses the smile score.
  - `HeadPoseDetector` detects turn, look and tilt, in the subject's own directions.
- Every detector smooths the signal (EMA) and uses hysteresis thresholds. It needs a neutral face first and at least 2 frames past the threshold, and gives each event a 0–1 confidence.

#### Challenges

- `ChallengeManager` with the catalog `blink`, `open-mouth`, `smile`, `turn-left`, `turn-right` and `head-tilt`. Each challenge is validated by its movement detector.
- `ChallengeRandomizer` picks a random order per session. The RNG is injectable, and the same sequence never comes twice in a row.
- Per-attempt timeout, a face-lost limit, retries, per-challenge state (`pending` → `active` → `completed` / `failed` / `timeout`), progress, and events tagged with the `sessionId`. The manager is driven by frames and uses no timers. It doesn't depend on PAD or React.

#### PAD

- The `PresentationAttackDetector` and `PadProvider` contracts. Statuses are `NO_ATTACK_DETECTED`, `PRESENTATION_ATTACK` and `INCONCLUSIVE`.
- The detector fails safe: errors, timeouts, cancellations and invalid answers become `INCONCLUSIVE`.
- Results are aggregated with the `strict` policy. The detector keeps a bounded in-memory history of results and accepts an `AbortSignal`.
- `NoopPadProvider` is a placeholder that always answers `INCONCLUSIVE`.

#### Sessions and programmatic API

- `FacialCheck` provides `initialize()`, `start()`, `stop()`, `destroy()`, `getStatus()`, `getResults()` and `attachVideo()`, plus typed `on` / `once` / `off` for the events `faceDetected`, `frame`, `challengeStarted`, `challengeCompleted`, `challengeFailed`, `progress`, `completed`, `error` and `statusChange`.
- `FacialSession` runs one session (id and timestamps): camera → engine → `FaceAnalyzer` → `ChallengeManager`, then the optional PAD on up to `pad.maxFrames` in-memory frames. The camera is released as soon as the session ends. Challenge results and the PAD verdict are reported separately.
- `FacialCheckError` with codes `CAMERA_ERROR`, `ENGINE_ERROR`, `PAD_ERROR`, `INVALID_CONFIG`, `INVALID_STATE`, `DESTROYED` and `UNKNOWN`.
- `EventEmitter`: a small typed event emitter.

#### React

- Headless hooks:
  - `useFacialCheck` runs the full flow.
  - `useFaceCamera` handles the camera.
  - `useFaceDetection` runs the engine and analyzer loop.
  - `useLivenessChallenges` drives the challenge engine from frames you feed it.
- Each hook initializes once per mounted component (StrictMode-safe) and releases its resources on unmount.
- Components:
  - `FaceLiveness` is the complete flow: preview, face frame, dynamic instructions, progress, per-challenge feedback, and loading, success, failure and error screens.
  - `FaceCamera`, `FaceGuide`, `ChallengeInstructions` and `LivenessProgress` are the building blocks.
- Customization: pt-BR texts that can be overridden, CSS custom properties (`--fc-*`), `className` / `classNames`, `unstyled`, and render props.

#### Quality, examples and docs

- Vitest suites cover unit, integration (full pipeline), detector, challenge engine, camera lifecycle, PAD and entry point tests, with coverage thresholds. Package compatibility (ESM/CJS, types under `node16` resolution) is checked with publint and arethetypeswrong. The repository also has benchmarks and a manual evaluation plan against photos, videos and screens (`tests/scenarios/README.md`). CI runs on Node 22 and 24.
- `examples/react` is a Vite + React demo with six examples: basic detection, face capture, challenges, full liveness, headless, and PAD integration.
- The README covers installation, requirements, configuration, model loading, the programmatic, React and headless APIs, challenges, events, PAD, errors, limitations, security and privacy (LGPD, biometric data, image retention), and the licenses of models and dependencies.

[Unreleased]: https://github.com/Davi9130/facial-check/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Davi9130/facial-check/releases/tag/v0.1.0
