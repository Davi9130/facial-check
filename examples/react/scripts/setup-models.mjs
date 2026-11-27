#!/usr/bin/env node
/**
 * Puts the model files the demo needs under public/ (see models/README.md
 * at the repository root):
 *
 * - public/models/            face-api.js 0.22.2 weights (MIT) and
 *                             MediaPipe face_landmarker.task (Apache 2.0)
 * - public/mediapipe/wasm/    wasm runtime copied from @mediapipe/tasks-vision
 *
 * Existing files are kept; pass --force to download them again.
 * Only model files are fetched: no image or video ever leaves the browser.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const modelsDir = join(root, "public/models");
const wasmDir = join(root, "public/mediapipe/wasm");

const FACE_API_BASE = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";
const FACE_API_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model-shard1",
];
const FACE_LANDMARKER_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

async function download(url, target) {
  if (!force && existsSync(target) && statSync(target).size > 0) {
    console.log(`  ok    ${relative(target)}`);
    return;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`  saved ${relative(target)}`);
}

function relative(path) {
  return path.slice(root.length + 1);
}

/** Finds @mediapipe/tasks-vision as seen from the linked facial-check package. */
function findTasksVisionWasm() {
  const require = createRequire(join(root, "package.json"));
  const sdkDir = dirname(require.resolve("facial-check/package.json"));
  for (const base of [sdkDir, root]) {
    const candidate = join(base, "node_modules/@mediapipe/tasks-vision/wasm");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("@mediapipe/tasks-vision not found. Run `npm install` in the repository root and in examples/react.");
}

mkdirSync(modelsDir, { recursive: true });
mkdirSync(wasmDir, { recursive: true });

console.log("face-api.js weights:");
for (const file of FACE_API_FILES) await download(`${FACE_API_BASE}/${file}`, join(modelsDir, file));

console.log("MediaPipe Face Landmarker:");
await download(FACE_LANDMARKER_URL, join(modelsDir, "face_landmarker.task"));

console.log("MediaPipe wasm runtime:");
const wasmSource = findTasksVisionWasm();
for (const file of readdirSync(wasmSource)) {
  copyFileSync(join(wasmSource, file), join(wasmDir, file));
  console.log(`  copied ${relative(join(wasmDir, file))}`);
}

console.log("Done.");
