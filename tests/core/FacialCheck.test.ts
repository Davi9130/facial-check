import { describe, expect, it, vi } from "vitest";
import { FacialCheck } from "../../src/core/FacialCheck";
import { FacialCheckError } from "../../src/core/FacialCheckError";
import { FaceEngineError } from "../../src/engines/FaceEngine";
import { PresentationAttackDetector } from "../../src/pad/PresentationAttackDetector";
import { StaticPadProvider } from "../../src/pad/PadProvider";
import type { ChallengeType } from "../../src/types/challenge.types";
import type { SessionPad } from "../../src/types/session.types";
import { domError } from "../camera/mocks";
import { PERFORM, rep, seeded } from "../challenges/frames";
import { flush, setup } from "./harness";

const TYPES: ChallengeType[] = ["blink", "open-mouth", "turn-left", "turn-right"];

async function performAll(play: (poses: Parameters<ReturnType<typeof setup>["play"]>[0]) => Promise<void>, types: readonly ChallengeType[]) {
  for (const type of types) await play(PERFORM[type]);
}

async function rejection(promise: Promise<unknown>): Promise<FacialCheckError> {
  try {
    await promise;
  } catch (error) {
    return error as FacialCheckError;
  }
  throw new Error("expected a rejection");
}

describe("FacialCheck — full flow (camera and engine mocked, no React)", () => {
  it("runs initialize → start → challenges → completed and separates the PAD verdict", async () => {
    const t = setup({ challenges: TYPES });
    expect(t.facialCheck.getStatus()).toBe("idle");

    await t.facialCheck.initialize();
    expect(t.engine.load).toHaveBeenCalledTimes(1);
    expect(t.facialCheck.getStatus()).toBe("ready");

    await t.facialCheck.start();
    expect(t.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.video.srcObject).not.toBeNull();
    expect(t.facialCheck.getStatus()).toBe("waiting-face");

    await performAll(t.play, TYPES);

    expect(t.facialCheck.getStatus()).toBe("completed");
    expect(t.of("challengeStarted").map((e) => e.challenge.type)).toEqual(TYPES);
    expect(t.of("challengeCompleted").map((e) => e.challenge.type)).toEqual(TYPES);
    expect(t.of("progress").at(-1)?.percent).toBe(100);

    const [result] = t.of("completed");
    expect(t.of("completed")).toHaveLength(1);
    expect(result).toEqual(t.facialCheck.getResults());
    expect(result?.sessionId).toBe("session-1");
    expect(result?.status).toBe("completed");
    expect(result?.engine).toBe("mock-engine");
    expect(result?.challenges.passed).toBe(true);
    expect(result?.challenges.sessionId).toBe("session-1");
    expect(result?.challenges.challenges.every((c) => c.status === "completed" && c.sessionId === "session-1")).toBe(true);
    expect(result?.pad).toBeNull();
    expect(result?.error).toBeNull();
    expect(result?.startedAt).toBeTypeOf("number");
    expect(result?.challengesStartedAt).toBeGreaterThan(result?.startedAt ?? Infinity);
    expect(result?.durationMs).toBe((result?.endedAt ?? 0) - (result?.startedAt ?? 0));

    // The camera is released as soon as the session ends.
    expect(t.stream.tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(t.camera.isActive).toBe(false);
    expect(t.scheduler.queue.size).toBe(0);
  });

  it("calls initialize() from start() when needed and reports the status sequence", async () => {
    const t = setup({ challenges: ["blink"] });
    await t.facialCheck.start();
    await t.play(rep(null, 3));
    await t.play(PERFORM.blink);
    expect(t.engine.load).toHaveBeenCalledTimes(1);
    expect(t.of("statusChange").map((e) => e.status)).toEqual([
      "initializing",
      "ready",
      "starting",
      "waiting-face",
      "running",
      "completed",
    ]);
  });

  it("waits for a face before starting the first challenge", async () => {
    const t = setup({ challenges: ["blink"], timeoutMs: 500 });
    await t.facialCheck.start();
    await t.play(rep(null, 60)); // ~2 s without a face: no challenge, no timeout.
    expect(t.facialCheck.getStatus()).toBe("waiting-face");
    expect(t.of("challengeStarted")).toHaveLength(0);
    expect(t.facialCheck.getResults().challenges.status).toBe("idle");

    await t.play(PERFORM.blink);
    expect(t.facialCheck.getStatus()).toBe("completed");
  });

  it("emits faceDetected when the face appears and disappears", async () => {
    const t = setup({ challenges: ["blink"], timeoutMs: 60_000, maxFaceLostMs: 60_000 });
    await t.facialCheck.start();
    await t.play([null, "neutral", "neutral", null, null, "neutral"]);
    expect(t.of("faceDetected").map((e) => e.detected)).toEqual([true, false, true]);
    expect(t.of("faceDetected")[0]).toMatchObject({ sessionId: "session-1", faceCount: 1, ready: true });
  });

  it("does not advance without the movement and ends as failed after the attempts", async () => {
    const t = setup({ challenges: ["blink", "smile"], timeoutMs: 1000, maxAttempts: 2 });
    await t.facialCheck.start();
    await t.play(rep("neutral", 70)); // two attempts of 1 s without blinking.

    expect(t.facialCheck.getStatus()).toBe("failed");
    expect(t.of("challengeCompleted")).toHaveLength(0);
    expect(t.of("challengeFailed").map((e) => [e.reason, e.willRetry])).toEqual([
      ["timeout", true],
      ["timeout", false],
    ]);
    const result = t.of("completed")[0];
    expect(result?.status).toBe("failed");
    expect(result?.challenges.passed).toBe(false);
    expect(result?.challenges.challenges.map((c) => c.status)).toEqual(["timeout", "pending"]);
    expect(t.camera.isActive).toBe(false);
  });
});

describe("FacialCheck — PAD", () => {
  it("runs the PAD after the challenges and reports it apart from them", async () => {
    const padDetector = new PresentationAttackDetector({ providers: [new StaticPadProvider({ status: "PRESENTATION_ATTACK" })] });
    const analyze = vi.spyOn(padDetector, "analyze");
    const t = setup({ challenges: ["blink", "smile"], padDetector });
    await t.facialCheck.start();
    await performAll(t.play, ["blink", "smile"]);
    await flush();

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const result = t.facialCheck.getResults();
    expect(result.status).toBe("completed");
    // The challenges passed, the PAD found an attack: two separate verdicts.
    expect(result.challenges.passed).toBe(true);
    expect(result.pad?.status).toBe("PRESENTATION_ATTACK");
    expect(t.of("statusChange").map((e) => e.status)).toContain("analyzing-pad");
    expect(t.of("completed")).toHaveLength(1);
  });

  it("runs the PAD even when a challenge failed, without changing the challenge verdict", async () => {
    const padDetector = new PresentationAttackDetector({ providers: [new StaticPadProvider({ status: "NO_ATTACK_DETECTED" })] });
    const t = setup({ challenges: ["blink"], timeoutMs: 500, maxAttempts: 1, padDetector });
    await t.facialCheck.start();
    await t.play(rep("neutral", 20));
    await flush();
    const result = t.facialCheck.getResults();
    expect(result.status).toBe("failed");
    expect(result.challenges.passed).toBe(false);
    expect(result.pad?.status).toBe("NO_ATTACK_DETECTED");
  });

  it("gives at most pad.maxFrames frames to the PAD and never retains them", async () => {
    const analyze = vi.fn<SessionPad["analyze"]>(async () => ({
      id: "pad-1",
      status: "INCONCLUSIVE",
      results: [],
      aggregation: "strict",
      startedAt: 0,
      completedAt: 0,
    }));
    const t = setup({ challenges: ["blink", "smile", "open-mouth"], padDetector: { analyze }, pad: { maxFrames: 2, timeoutMs: 1234 } });
    vi.spyOn(t.camera, "captureFrame").mockImplementation(() => document.createElement("canvas"));
    await t.facialCheck.start();
    await performAll(t.play, ["blink", "smile", "open-mouth"]);
    await flush();

    const [input, options] = analyze.mock.calls[0] ?? [];
    expect(options?.timeoutMs).toBe(1234);
    // The array handed to the PAD is emptied once it answered.
    expect(input?.frames).toHaveLength(0);
    expect(t.camera.captureFrame).toHaveBeenCalledTimes(2);
    expect(t.facialCheck.getResults().pad?.status).toBe("INCONCLUSIVE");
  });

  it("reports a rejecting PAD as a non-fatal PAD_ERROR and keeps the challenge result", async () => {
    const t = setup({ challenges: ["blink"], padDetector: { analyze: () => Promise.reject(new Error("vendor down")) } });
    await t.facialCheck.start();
    await t.play(PERFORM.blink);
    await flush();
    expect(t.facialCheck.getStatus()).toBe("completed");
    expect(t.facialCheck.getResults().pad).toBeNull();
    expect(t.facialCheck.getResults().challenges.passed).toBe(true);
    expect(t.of("error").map((e) => [e.error.code, e.fatal])).toEqual([["PAD_ERROR", false]]);
  });

  it("aborts a pending PAD on stop()", async () => {
    let signal: AbortSignal | undefined;
    const t = setup({
      challenges: ["blink"],
      padDetector: {
        analyze: (_input, options) => {
          signal = options?.signal;
          return new Promise(() => undefined);
        },
      },
    });
    await t.facialCheck.start();
    await t.play(PERFORM.blink);
    expect(t.facialCheck.getStatus()).toBe("analyzing-pad");
    t.facialCheck.stop();
    expect(signal?.aborted).toBe(true);
    expect(t.facialCheck.getStatus()).toBe("stopped");
    expect(t.of("completed")).toHaveLength(0);
  });
});

describe("FacialCheck — stop, restart and destroy", () => {
  it("stop() ends the session, releases the camera and allows a new session", async () => {
    const t = setup({ challenges: ["blink", "smile"] });
    await t.facialCheck.start();
    await t.play(PERFORM.blink);
    t.facialCheck.stop();

    expect(t.facialCheck.getStatus()).toBe("stopped");
    expect(t.camera.isActive).toBe(false);
    expect(t.scheduler.queue.size).toBe(0);
    expect(t.of("completed")).toHaveLength(0);
    const stopped = t.facialCheck.getResults();
    expect(stopped.challenges.status).toBe("stopped");
    expect(stopped.challenges.challenges.map((c) => c.status)).toEqual(["completed", "failed"]);

    await t.facialCheck.start();
    expect(t.facialCheck.sessionId).toBe("session-2");
    expect(t.engine.load).toHaveBeenCalledTimes(1); // the engine stays loaded.
    await performAll(t.play, ["blink", "smile"]);
    expect(t.facialCheck.getResults()).toMatchObject({ sessionId: "session-2", status: "completed" });
  });

  it("start() is a no-op while a session runs", async () => {
    const t = setup({ challenges: ["blink"] });
    await t.facialCheck.start();
    await t.facialCheck.start();
    expect(t.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.facialCheck.sessionId).toBe("session-1");
  });

  it("destroy() releases camera and engine and makes the instance unusable", async () => {
    const t = setup({ challenges: ["blink", "smile"] });
    await t.facialCheck.start();
    await t.play(rep("neutral", 3));
    t.facialCheck.destroy();

    expect(t.facialCheck.getStatus()).toBe("destroyed");
    expect(t.stream.tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
    expect(t.camera.isActive).toBe(false);
    expect(t.video.srcObject).toBeNull();
    expect(t.engine.dispose).toHaveBeenCalledTimes(1);
    expect(t.engine.isLoaded).toBe(false);
    expect(t.scheduler.queue.size).toBe(0);

    expect((await rejection(t.facialCheck.start())).code).toBe("DESTROYED");
    expect((await rejection(t.facialCheck.initialize())).code).toBe("DESTROYED");
    expect(() => t.facialCheck.destroy()).not.toThrow();
  });

  it("destroy() during initialize() disposes the engine once loaded", async () => {
    const t = setup();
    let finishLoad!: () => void;
    t.engine.load.mockImplementationOnce(() => new Promise<void>((resolve) => (finishLoad = resolve)));
    const init = t.facialCheck.initialize();
    t.facialCheck.destroy();
    finishLoad();
    expect((await rejection(init)).code).toBe("DESTROYED");
    expect(t.engine.dispose).toHaveBeenCalled();
  });
});

describe("FacialCheck — errors", () => {
  it("rejects start() with CAMERA_ERROR and emits a fatal error when the camera is denied", async () => {
    const t = setup();
    t.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const error = await rejection(t.facialCheck.start());
    expect(error).toBeInstanceOf(FacialCheckError);
    expect(error.code).toBe("CAMERA_ERROR");
    expect((error.cause as { code?: string }).code).toBe("PERMISSION_DENIED");
    expect(t.facialCheck.getStatus()).toBe("error");
    expect(t.facialCheck.getResults().error).toEqual({ code: "CAMERA_ERROR", message: error.message });
    expect(t.of("error").map((e) => [e.error.code, e.fatal])).toEqual([["CAMERA_ERROR", true]]);

    // A new session can be tried after an error.
    await t.facialCheck.start();
    expect(t.facialCheck.getStatus()).toBe("waiting-face");
  });

  it("rejects initialize() with ENGINE_ERROR when the models cannot load, and can retry", async () => {
    const t = setup();
    t.engine.load.mockRejectedValueOnce(new FaceEngineError("MODEL_LOAD_FAILED", "mock-engine", "nope"));
    const error = await rejection(t.facialCheck.initialize());
    expect(error.code).toBe("ENGINE_ERROR");
    expect(t.facialCheck.getStatus()).toBe("idle");
    expect(t.of("error")[0]?.fatal).toBe(true);
    await t.facialCheck.initialize();
    expect(t.facialCheck.getStatus()).toBe("ready");
  });

  it("tolerates transient detection errors but ends with ENGINE_ERROR when they persist", async () => {
    const t = setup({ challenges: ["blink"], maxDetectionErrors: 3 });
    await t.facialCheck.start();
    t.engine.detect.mockRejectedValueOnce(new Error("glitch"));
    await t.play(["neutral", "neutral"]);
    expect(t.facialCheck.getStatus()).toBe("running");

    t.engine.detect.mockRejectedValue(new Error("broken"));
    await t.frames(3);
    expect(t.facialCheck.getStatus()).toBe("error");
    expect(t.of("error").map((e) => e.error.code)).toEqual(["ENGINE_ERROR"]);
    expect(t.camera.isActive).toBe(false);
  });

  it("ends with CAMERA_ERROR when the camera stops on its own", async () => {
    const t = setup({ challenges: ["blink"] });
    await t.facialCheck.start();
    await t.play(rep("neutral", 2));
    t.stream.tracks[0]?.end();
    await t.frames(1);
    expect(t.facialCheck.getStatus()).toBe("error");
    expect(t.of("error")[0]?.error.code).toBe("CAMERA_ERROR");
  });
});

describe("FacialCheck — configuration", () => {
  it("uses face-api.js by default and MediaPipe when selected", () => {
    expect(new FacialCheck().engineName).toBe("face-api");
    expect(new FacialCheck({ engine: "face-api" }).engineName).toBe("face-api");
    expect(new FacialCheck({ engine: "mediapipe" }).engineName).toBe("mediapipe");
  });

  it.each([
    [{ engine: "opencv" as never }],
    [{ challenges: ["jump" as never] }],
    [{ challenges: [] }],
    [{ maxFps: 0 }],
    [{ maxDetectionErrors: 0 }],
    [{ pad: { maxFrames: -1 } }],
    [{ timeoutMs: -5 }],
  ])("rejects invalid configuration %j with INVALID_CONFIG", (config) => {
    expect(() => new FacialCheck(config)).toThrow(expect.objectContaining({ code: "INVALID_CONFIG" }));
  });

  it("varies the challenge order between sessions with randomChallenges", async () => {
    const t = setup({ challenges: TYPES, randomChallenges: true, random: seeded(7) });
    const orders: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await t.facialCheck.start();
      await t.play(["neutral"]);
      orders.push(t.facialCheck.getResults().challenges.challenges.map((c) => c.type).join(","));
      t.facialCheck.stop();
    }
    for (const order of orders) expect(order.split(",").sort()).toEqual([...TYPES].sort());
    for (let i = 1; i < orders.length; i += 1) expect(orders[i]).not.toBe(orders[i - 1]);
  });

  it("getResults() before any session is empty", () => {
    const t = setup();
    expect(t.facialCheck.getResults()).toMatchObject({ sessionId: "", status: "idle", pad: null, challenges: { passed: false, challenges: [] } });
  });

  it("creates an off-screen <video> when none is given and uses attachVideo()", async () => {
    const t = setup({ challenges: ["blink"], video: undefined as never });
    const attach = vi.spyOn(t.camera, "attach");
    await t.facialCheck.start();
    expect(attach.mock.calls[0]?.[0]).toBeInstanceOf(HTMLVideoElement);
    t.facialCheck.attachVideo(t.video);
    expect(attach).toHaveBeenLastCalledWith(t.video);
  });
});
