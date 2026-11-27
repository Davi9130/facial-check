import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFacialCheck, type UseFacialCheckOptions } from "../../src/react";
import type { ChallengeType } from "../../src/types/challenge.types";
import { domError } from "../camera/mocks";
import { PERFORM, rep } from "../challenges/frames";
import { deps, settle } from "./helpers";

const TYPES: ChallengeType[] = ["blink", "open-mouth"];

function config(d: ReturnType<typeof deps>, extra: UseFacialCheckOptions = {}): UseFacialCheckOptions {
  return {
    engine: d.engine,
    camera: d.camera,
    analyzer: d.analyzer,
    scheduler: d.scheduler,
    video: d.video,
    now: d.now,
    challenges: TYPES,
    randomChallenges: false,
    maxFps: 1000,
    createSessionId: () => "session-1",
    ...extra,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useFacialCheck", () => {
  it("mirrors a full session: status, face, current challenge, progress and result", async () => {
    const d = deps();
    const onSuccess = vi.fn();
    const onChallengeStarted = vi.fn();
    const { result } = renderHook(() => useFacialCheck(config(d, { onSuccess, onChallengeStarted })));
    expect(result.current.status).toBe("idle");
    expect(result.current.facialCheck).toBeNull();

    await settle();
    expect(result.current.facialCheck).not.toBeNull();

    await act(() => result.current.start());
    expect(result.current.status).toBe("waiting-face");
    expect(result.current.sessionId).toBe("session-1");
    expect(d.getUserMedia).toHaveBeenCalledTimes(1);

    await d.play(rep("neutral", 2));
    expect(result.current.faceDetected).toBe(true);
    expect(result.current.status).toBe("running");
    expect(result.current.currentChallenge).toBe("blink");
    expect(result.current.challenge?.type).toBe("blink");

    await d.play(PERFORM.blink);
    expect(result.current.currentChallenge).toBe("open-mouth");
    expect(result.current.progress).toBe(50);

    await d.play(PERFORM["open-mouth"]);
    expect(result.current.status).toBe("completed");
    expect(result.current.progress).toBe(100);
    expect(result.current.currentChallenge).toBeNull();
    expect(result.current.result?.challenges.passed).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(result.current.result);
    expect(onChallengeStarted.mock.calls.map(([e]) => e.challenge.type)).toEqual(TYPES);
  });

  it("stop() ends the session and releases the camera", async () => {
    const d = deps();
    const { result } = renderHook(() => useFacialCheck(config(d)));
    await settle();
    await act(() => result.current.start());
    act(() => result.current.stop());
    expect(result.current.status).toBe("stopped");
    expect(d.stream.tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });

  it("releases camera, engine and listeners on unmount", async () => {
    const d = deps();
    const { result, unmount } = renderHook(() => useFacialCheck(config(d)));
    await settle();
    await act(() => result.current.start());
    const instance = result.current.facialCheck;
    unmount();
    expect(instance?.getStatus()).toBe("destroyed");
    expect(d.camera.isActive).toBe(false);
    expect(d.stream.tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
    expect(d.engine.dispose).toHaveBeenCalled();
    expect(d.scheduler.queue.size).toBe(0);
  });

  it("initializes only once under StrictMode", async () => {
    const d = deps();
    const { result } = renderHook(() => useFacialCheck(config(d, { autoStart: true })), { wrapper: StrictMode });
    await settle();
    expect(d.engine.load).toHaveBeenCalledTimes(1);
    expect(d.getUserMedia).toHaveBeenCalledTimes(1);
    expect(d.engine.dispose).not.toHaveBeenCalled();
    expect(result.current.status).toBe("waiting-face");
  });

  it("autoInitialize loads the models without opening the camera", async () => {
    const d = deps();
    const { result } = renderHook(() => useFacialCheck(config(d, { autoInitialize: true })));
    await settle();
    expect(d.engine.load).toHaveBeenCalledTimes(1);
    expect(d.getUserMedia).not.toHaveBeenCalled();
    expect(result.current.status).toBe("ready");
  });

  it("reports a denied camera once in error / onError and start() does not reject", async () => {
    const d = deps();
    d.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const onError = vi.fn();
    const { result } = renderHook(() => useFacialCheck(config(d, { onError })));
    await settle();
    await act(() => result.current.start());
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("CAMERA_ERROR");
    expect(onError).toHaveBeenCalledTimes(1);

    // A new session clears the previous error.
    await act(() => result.current.start());
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("waiting-face");
  });

  it("reports an invalid configuration as INVALID_CONFIG", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useFacialCheck({ maxFps: -1, onError }));
    await settle();
    expect(result.current.error?.code).toBe("INVALID_CONFIG");
    expect(result.current.facialCheck).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callbacks without recreating the instance", async () => {
    const d = deps();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook((props: { onStatusChange: () => void }) => useFacialCheck(config(d, props)), {
      initialProps: { onStatusChange: first },
    });
    await settle();
    const instance = result.current.facialCheck;
    rerender({ onStatusChange: second });
    await settle();
    await act(() => result.current.initialize());
    expect(result.current.facialCheck).toBe(instance);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("works with a custom interface (section 5.3) and attaches its <video> through videoRef", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const d = deps();
    const options = config(d);
    delete options.video;

    function CustomLiveness() {
      const { status, faceDetected, currentChallenge, progress, start, stop, videoRef } = useFacialCheck(options);
      return (
        <div>
          <video data-testid="video" ref={videoRef} />
          <p data-testid="status">{status}</p>
          <p data-testid="face">{faceDetected ? "face" : "no-face"}</p>
          <p data-testid="challenge">{currentChallenge}</p>
          <p data-testid="progress">{progress}%</p>
          <button onClick={() => void start()}>Iniciar</button>
          <button onClick={stop}>Parar</button>
        </div>
      );
    }

    render(<CustomLiveness />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByText("Iniciar"));
    });
    await settle();
    expect(screen.getByTestId("status").textContent).toBe("waiting-face");
    expect((screen.getByTestId("video") as HTMLVideoElement).srcObject).not.toBeNull();

    await d.play([...rep("neutral", 2), ...PERFORM.blink]);
    expect(screen.getByTestId("face").textContent).toBe("face");
    expect(screen.getByTestId("challenge").textContent).toBe("open-mouth");
    expect(screen.getByTestId("progress").textContent).toBe("50%");

    act(() => {
      fireEvent.click(screen.getByText("Parar"));
    });
    expect(screen.getByTestId("status").textContent).toBe("stopped");
  });
});
