import { describe, expect, it } from "vitest";
import { FaceEngineError, isFaceEngineError, type FaceEngine } from "../../src/engines/FaceEngine";
import type { FaceDetectionResult } from "../../src/types/face.types";

/** A minimal third-party engine: implementing the interface is all it takes. */
class StaticEngine implements FaceEngine {
  readonly name = "static";
  isLoaded = false;
  async load() {
    this.isLoaded = true;
  }
  async detect(): Promise<FaceDetectionResult[]> {
    return [
      {
        box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        score: 1,
        imageSize: { width: 640, height: 480 },
        blendshapes: { jawOpen: 0.7 },
        pose: { yaw: 10, pitch: 0, roll: -2 },
      },
    ];
  }
  dispose() {
    this.isLoaded = false;
  }
}

describe("FaceEngine contract", () => {
  it("accepts custom engines with optional blendshapes and pose", async () => {
    const engine: FaceEngine = new StaticEngine();
    await engine.load();
    const [face] = await engine.detect(document.createElement("canvas"));
    expect(face?.blendshapes?.["jawOpen"]).toBe(0.7);
    expect(face?.pose?.yaw).toBe(10);
    engine.dispose();
    expect(engine.isLoaded).toBe(false);
  });

  it("FaceEngineError carries code, engine and cause", () => {
    const cause = new Error("boom");
    const error = new FaceEngineError("DETECTION_FAILED", "static", "failed", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(isFaceEngineError(error)).toBe(true);
    expect(isFaceEngineError(cause)).toBe(false);
    expect(error).toMatchObject({ name: "FaceEngineError", code: "DETECTION_FAILED", engine: "static", cause });
  });
});
