import { Bench } from "tinybench";
import { it } from "vitest";
import { EyeAnalyzer } from "../src/analysis/EyeAnalyzer";
import { FaceAnalyzer } from "../src/analysis/FaceAnalyzer";
import { HeadPoseAnalyzer } from "../src/analysis/HeadPoseAnalyzer";
import { MouthAnalyzer } from "../src/analysis/MouthAnalyzer";
import { ChallengeManager } from "../src/challenges/ChallengeManager";
import { BlinkDetector } from "../src/detectors/BlinkDetector";
import { HeadPoseDetector } from "../src/detectors/HeadPoseDetector";
import { MouthDetector } from "../src/detectors/MouthDetector";
import { SmileDetector } from "../src/detectors/SmileDetector";
import type { FaceAnalysis } from "../src/types/analysis.types";
import type { FaceDetectionResult } from "../src/types/face.types";
import { syntheticFace } from "../tests/analysis/syntheticFace";

/**
 * Per-frame cost of the analysis pipeline (everything after the engine).
 * A 30 fps camera leaves ~33 ms per frame and the engine (face-api.js /
 * MediaPipe) takes most of it, so analyzers + detectors + challenges should
 * stay far below 1 ms. Run with `npm run bench`.
 */

const FRAME_MS = 33;
// Pre-built frames (blinks, a head turn, mouth opening) so the bench measures
// the analysis, not the synthetic-face generator.
const FRAMES: FaceDetectionResult[] = Array.from({ length: 60 }, (_, i) =>
  syntheticFace({ eyeOpen: i % 20 < 3 ? 0.05 : 0.5, yaw: 30 * Math.sin(i / 10), mouthGap: i % 30 > 20 ? 2 : 0 }),
);
const frameAt = (n: number): FaceDetectionResult => FRAMES[n % FRAMES.length] as FaceDetectionResult;

function cycle(): () => number {
  let n = 0;
  return () => n++;
}

it("per-frame pipeline benchmark", async () => {
  const bench = new Bench({ name: "facial-check per frame", time: 300, warmup: true });

  const eyes = new EyeAnalyzer();
  const mouth = new MouthAnalyzer();
  const pose = new HeadPoseAnalyzer();
  const face = new FaceAnalyzer();
  const nA = cycle();
  bench
    .add("EyeAnalyzer.analyze", () => void eyes.analyze(frameAt(nA())))
    .add("MouthAnalyzer.analyze", () => void mouth.analyze(frameAt(nA())))
    .add("HeadPoseAnalyzer.analyze", () => void pose.analyze(frameAt(nA())))
    .add("FaceAnalyzer.analyze", () => {
      const n = nA();
      face.analyze(frameAt(n), n * FRAME_MS);
    });

  const pre = new FaceAnalyzer();
  const analyses: FaceAnalysis[] = FRAMES.map((f, i) => pre.analyze(f, i * FRAME_MS));
  const detectors = {
    "BlinkDetector.update": new BlinkDetector(),
    "MouthDetector.update": new MouthDetector(),
    "SmileDetector.update": new SmileDetector(),
    "HeadPoseDetector.update": new HeadPoseDetector(),
  };
  for (const [name, detector] of Object.entries(detectors)) {
    const next = cycle();
    bench.add(name, () => {
      const n = next();
      detector.update(analyses[n % analyses.length] as FaceAnalysis, n * FRAME_MS);
    });
  }

  const analyzer = new FaceAnalyzer();
  const manager = new ChallengeManager({ timeoutMs: 1e12, maxAttempts: 1e6, randomChallenges: false, now: () => 0 });
  const nP = cycle();
  bench.add("FaceAnalyzer + ChallengeManager (full frame)", () => {
    const n = nP();
    const ts = n * FRAME_MS;
    if (manager.getStatus() !== "running") manager.start({ timestamp: ts });
    manager.update(analyzer.analyze(frameAt(n), ts), ts);
  });

  await bench.run();
  console.table(bench.table());
}, 120_000);
