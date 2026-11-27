# Changelog

All notable changes to `facial-check` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While in `0.x`, minor releases may contain breaking changes; they are called out explicitly.

## [Unreleased]

### Added

- `FaceEngine` contract and engine-agnostic result types (`FaceDetectionResult`, normalized box and landmarks grouped by region, optional blendshapes and head pose), exported from `facial-check/core`.
- `FaceApiEngine`: face-api.js 0.22.2 engine (TinyFaceDetector and 68-point landmarks) with a configurable model URL, lazy loading and per-instance networks.
- `FaceEngineError` with codes `MODEL_LOAD_FAILED`, `NOT_LOADED` and `DETECTION_FAILED`.
- `models/README.md`: which model files to serve and how.
- `MediaPipeEngine`: MediaPipe Tasks Vision `FaceLandmarker` engine (`VIDEO` mode) with blendshapes, head pose (yaw/pitch/roll from the transformation matrix), the mesh mapped to the 68-point regions, configurable wasm/model paths, a `maxFps` limit, no reprocessing of the same video frame, and a GPU→CPU fallback. Exported from `facial-check/core` with `MEDIAPIPE_MODEL_FILES`.
- Movement detectors in `facial-check/detectors`: `BlinkDetector` (EAR or eye openness, open → closed → open within `maxClosedMs`), `MouthDetector` (MAR or `jawOpen`), `SmileDetector` and `HeadPoseDetector` (turn, look and tilt in the subject's own directions). Each one smooths the signal (EMA), uses hysteresis thresholds, needs the face at rest first and at least 2 frames past the threshold, and gives every event a 0–1 confidence. They accept a `FaceAnalysis` or a raw `FaceDetectionResult`.
- Challenge engine (`ChallengeManager`, exported from `facial-check` and `facial-check/core`): catalog `blink`, `open-mouth`, `smile`, `turn-left`, `turn-right`, `head-tilt`, each validated by its movement detector; random selection per session (`ChallengeRandomizer`, injectable RNG, never the same sequence twice in a row), per-attempt timeout, face-lost limit and retries, per-challenge state (`pending` → `active` → `completed`/`failed`/`timeout`), progress, and `challengeStarted` / `challengeCompleted` / `challengeFailed` / `progress` / `finished` events tagged with the `sessionId`. Frame-driven, with no timers, and independent of PAD and React.
- `EventEmitter`: small typed event emitter in `facial-check/core`.
- Programmatic API `FacialCheck` (exported from `facial-check` and `facial-check/core`): `initialize()`, `start()`, `stop()`, `destroy()`, `getStatus()`, `getResults()`, `attachVideo()`, and typed `on` / `once` / `off` for `faceDetected`, `frame`, `challengeStarted`, `challengeCompleted`, `challengeFailed`, `progress`, `completed`, `error` and `statusChange`. Engine selected with `engine` (`"face-api"` by default, `"mediapipe"`, or any `FaceEngine`).
- `FacialSession`: one session (id, timestamps) running camera → engine → `FaceAnalyzer` → `ChallengeManager`, then the optional PAD on up to `pad.maxFrames` in-memory frames. Challenges start on the first face; the camera is released as soon as the session ends. The result reports the presence challenges (`challenges`) and the PAD verdict (`pad`) separately.
- `FacialCheckError` with codes `CAMERA_ERROR`, `ENGINE_ERROR`, `PAD_ERROR`, `INVALID_CONFIG`, `INVALID_STATE`, `DESTROYED`, `UNKNOWN`.

## [0.1.0]

### Added

- Project scaffolding: `package.json`, strict TypeScript, tsup build (ESM + CJS + `.d.ts`/`.d.cts`), ESLint, Vitest (jsdom).
- Public entry points `facial-check`, `facial-check/react`, `facial-check/core` and `facial-check/detectors` (empty placeholders for now).
- `face-api.js@0.22.2` and `@mediapipe/tasks-vision` as dependencies; React and React DOM as optional peer dependencies.
