# Changelog

All notable changes to `facial-check` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While in `0.x`, minor releases may contain breaking changes; they are called out explicitly.

## [Unreleased]

### Added

- `FaceEngine` contract and engine-agnostic result types (`FaceDetectionResult`, normalized box and landmarks grouped by region, optional blendshapes and head pose), exported from `facial-check/core`.
- `FaceApiEngine`: face-api.js 0.22.2 engine (TinyFaceDetector and 68-point landmarks) with a configurable model URL, lazy loading and per-instance networks.
- `FaceEngineError` with codes `MODEL_LOAD_FAILED`, `NOT_LOADED` and `DETECTION_FAILED`.
- `models/README.md`: which model files to serve and how.

## [0.1.0]

### Added

- Project scaffolding: `package.json`, strict TypeScript, tsup build (ESM + CJS + `.d.ts`/`.d.cts`), ESLint, Vitest (jsdom).
- Public entry points `facial-check`, `facial-check/react`, `facial-check/core` and `facial-check/detectors` (empty placeholders for now).
- `face-api.js@0.22.2` and `@mediapipe/tasks-vision` as dependencies; React and React DOM as optional peer dependencies.
