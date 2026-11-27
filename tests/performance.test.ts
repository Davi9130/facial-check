import { describe, expect, it } from "vitest";
import { FaceAnalyzer } from "../src/analysis/FaceAnalyzer";
import { ChallengeManager } from "../src/challenges/ChallengeManager";
import { syntheticFace } from "./analysis/syntheticFace";

/**
 * Coarse performance budget (the detailed numbers come from `npm run bench`).
 * The limit is deliberately generous so it only catches regressions of an
 * order of magnitude (e.g. an accidental O(n²) over the history), not noise
 * on slow CI machines.
 */
describe("performance budget", () => {
  it("analysis + challenges stay under 2 ms per frame on average", () => {
    const frames = Array.from({ length: 30 }, (_, i) => syntheticFace({ yaw: 25 * Math.sin(i / 5), eyeOpen: i % 10 === 0 ? 0.05 : 0.5 }));
    const analyzer = new FaceAnalyzer();
    const manager = new ChallengeManager({ timeoutMs: 1e12, maxAttempts: 1e6, randomChallenges: false, now: () => 0 });
    manager.start({ timestamp: 0 });
    const N = 3_000;
    const step = (n: number) => {
      const ts = n * 33;
      if (manager.getStatus() !== "running") manager.start({ timestamp: ts });
      manager.update(analyzer.analyze(frames[n % frames.length] as (typeof frames)[number], ts), ts);
    };
    for (let n = 0; n < 200; n += 1) step(n); // warm-up
    const t0 = performance.now();
    for (let n = 200; n < 200 + N; n += 1) step(n);
    const perFrame = (performance.now() - t0) / N;
    expect(perFrame).toBeLessThan(2);
  });
});
