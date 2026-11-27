import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLivenessChallenges } from "../../src/react";
import { PERFORM, frame, play } from "../challenges/frames";
import { settle } from "./helpers";

describe("useLivenessChallenges", () => {
  it("runs a challenge session fed by the caller's frames", async () => {
    const onFinished = vi.fn();
    const { result } = renderHook(
      () =>
        useLivenessChallenges({
          challenges: ["blink", "smile"],
          randomChallenges: false,
          autoStart: true,
          now: () => 0,
          onFinished,
        }),
      { wrapper: StrictMode },
    );
    await settle();
    expect(result.current.status).toBe("running");
    expect(result.current.currentChallenge).toBe("blink");
    expect(result.current.challenges.map((c) => c.type)).toEqual(["blink", "smile"]);

    let ts = 0;
    act(() => {
      ts = play((input, t) => result.current.update(input, t), PERFORM.blink, ts);
    });
    expect(result.current.currentChallenge).toBe("smile");
    expect(result.current.progress).toBe(50);

    act(() => {
      play((input, t) => result.current.update(input, t), PERFORM.smile, ts);
    });
    expect(result.current.status).toBe("passed");
    expect(result.current.result?.passed).toBe(true);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not advance without the movement", async () => {
    const { result } = renderHook(() => useLivenessChallenges({ challenges: ["blink"], timeoutMs: 60_000 }));
    await settle();
    act(() => result.current.start({ timestamp: 0 }));
    act(() => {
      for (let ts = 0; ts < 2000; ts += 33) result.current.update(frame("neutral", ts), ts);
    });
    expect(result.current.status).toBe("running");
    expect(result.current.challenge?.status).toBe("active");
  });

  it("stop() and reset() update the state", async () => {
    const { result } = renderHook(() => useLivenessChallenges({ challenges: ["blink"], autoStart: true }));
    await settle();
    act(() => result.current.stop());
    expect(result.current.status).toBe("stopped");
    expect(result.current.result?.passed).toBe(false);
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
  });

  it("destroys the manager on unmount", async () => {
    const { result, unmount } = renderHook(() => useLivenessChallenges({ challenges: ["blink"], autoStart: true }));
    await settle();
    const manager = result.current.manager;
    if (!manager) throw new Error("expected a manager");
    const destroy = vi.spyOn(manager, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("reports invalid options", async () => {
    const onError = vi.fn();
    // @ts-expect-error unknown challenge on purpose
    const { result } = renderHook(() => useLivenessChallenges({ challenges: ["wink"], onError }));
    await settle();
    expect(result.current.error).toBeInstanceOf(RangeError);
    expect(result.current.manager).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
