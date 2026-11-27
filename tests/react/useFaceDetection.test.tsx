import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FaceApiEngine } from "../../src/engines/FaceApiEngine";
import { FaceEngineError } from "../../src/engines/FaceEngine";
import { useFaceDetection, type UseFaceDetectionOptions } from "../../src/react";
import { rep } from "../challenges/frames";
import { createEngine } from "../core/harness";
import { deps, settle } from "./helpers";

function options(d: ReturnType<typeof deps>, extra: UseFaceDetectionOptions = {}): UseFaceDetectionOptions {
  return { engine: d.engine, analyzer: d.analyzer, scheduler: d.scheduler, video: d.video, now: d.now, maxFps: 1000, ...extra };
}

describe("useFaceDetection", () => {
  it("loads the engine once under StrictMode and detects faces frame by frame", async () => {
    const d = deps();
    const onResult = vi.fn();
    const { result } = renderHook(() => useFaceDetection(options(d, { onResult })), { wrapper: StrictMode });
    await settle();
    expect(d.engine.load).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("detecting");

    await d.play(["neutral"]);
    expect(result.current.faceDetected).toBe(true);
    expect(result.current.faces).toHaveLength(1);
    expect(result.current.analysis?.faceDetected).toBe(true);
    expect(d.engine.detect).toHaveBeenCalledWith(d.video);

    await d.play([null]);
    expect(result.current.faceDetected).toBe(false);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("does not detect while disabled and follows the enabled option", async () => {
    const d = deps();
    const { result, rerender } = renderHook((props: { enabled: boolean }) => useFaceDetection(options(d, props)), {
      initialProps: { enabled: false },
    });
    await settle();
    expect(result.current.status).toBe("ready");
    await d.play(rep("neutral", 3));
    expect(d.engine.detect).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await settle();
    expect(result.current.status).toBe("detecting");
    await d.play(["neutral"]);
    expect(d.engine.detect).toHaveBeenCalledTimes(1);

    act(() => result.current.stop());
    expect(result.current.status).toBe("ready");
    expect(d.scheduler.queue.size).toBe(0);
  });

  it("disposes the engine it created on unmount, but not an engine it was given", async () => {
    const d = deps();
    const { unmount } = renderHook(() => useFaceDetection(options(d)));
    await settle();
    unmount();
    expect(d.engine.dispose).not.toHaveBeenCalled();
    expect(d.scheduler.queue.size).toBe(0);
  });

  it("disposes the built-in engine it created on unmount", async () => {
    const d = deps();
    const load = vi.spyOn(FaceApiEngine.prototype, "load").mockResolvedValue(undefined);
    const dispose = vi.spyOn(FaceApiEngine.prototype, "dispose").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useFaceDetection({ scheduler: d.scheduler, video: d.video }), {
      wrapper: StrictMode,
    });
    await settle();
    expect(result.current.engine).toBeInstanceOf(FaceApiEngine);
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    load.mockRestore();
    dispose.mockRestore();
  });

  it("stops the loop on unmount even while a frame is being detected", async () => {
    const d = deps();
    const { unmount } = renderHook(() => useFaceDetection(options(d)));
    await settle();
    d.scene.push(["neutral"]);
    d.scheduler.run(); // detection in flight
    unmount();
    await settle();
    expect(d.scheduler.queue.size).toBe(0);
  });

  it("reports a model load failure", async () => {
    const d = deps();
    const engine = createEngine(d.scene);
    engine.load.mockRejectedValueOnce(new FaceEngineError("MODEL_LOAD_FAILED", "mock-engine", "boom"));
    const onError = vi.fn();
    const { result } = renderHook(() => useFaceDetection(options(d, { engine, onError })));
    await settle();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeInstanceOf(FaceEngineError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stops with error after maxDetectionErrors consecutive failures", async () => {
    const d = deps();
    d.engine.detect.mockRejectedValue(new FaceEngineError("DETECTION_FAILED", "mock-engine", "boom"));
    const { result } = renderHook(() => useFaceDetection(options(d, { maxDetectionErrors: 2 })));
    await settle();
    await d.frames(1);
    expect(result.current.status).toBe("detecting");
    await d.frames(1);
    expect(result.current.status).toBe("error");
    expect(d.scheduler.queue.size).toBe(0);
  });
});
