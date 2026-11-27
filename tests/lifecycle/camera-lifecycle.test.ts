import { describe, expect, it } from "vitest";
import { asStream, FakeStream } from "../camera/mocks";
import { flush, setup } from "../core/harness";
import { rep } from "../challenges/frames";

/**
 * Camera lifecycle through the public `FacialCheck` API, with the real
 * `CameraManager` on a mocked `getUserMedia`: no stream must outlive
 * stop() / destroy(), whatever the timing.
 */
function withFreshStreams(t: ReturnType<typeof setup>) {
  const streams: FakeStream[] = [];
  t.getUserMedia.mockImplementation(async () => {
    const s = new FakeStream();
    streams.push(s);
    return asStream(s);
  });
  const live = () => streams.flatMap((s) => s.tracks).filter((track) => track.readyState === "live");
  return { streams, live };
}

describe("camera lifecycle", () => {
  it("start/stop cycles open one stream per session and leak none", async () => {
    const t = setup({ challenges: ["blink"] });
    const { streams, live } = withFreshStreams(t);
    for (let i = 0; i < 5; i += 1) {
      await t.facialCheck.start();
      await t.play(rep("neutral", 2));
      expect(live()).toHaveLength(1);
      t.facialCheck.stop();
      expect(live()).toHaveLength(0);
    }
    expect(streams).toHaveLength(5);
    expect(t.scheduler.queue.size).toBe(0);
  });

  it("stop() while the permission prompt is open releases the late stream", async () => {
    const t = setup({ challenges: ["blink"] });
    const late = new FakeStream();
    let grant!: () => void;
    t.getUserMedia.mockImplementationOnce(() => new Promise((resolve) => (grant = () => resolve(asStream(late)))));
    const started = t.facialCheck.start().catch((e: unknown) => e);
    await flush();
    t.facialCheck.stop();
    grant();
    await started;
    await flush();
    expect(late.tracks.every((track) => track.readyState === "ended")).toBe(true);
    expect(t.camera.isActive).toBe(false);
    expect(t.scheduler.queue.size).toBe(0);
  });

  it("destroy() while the permission prompt is open releases the late stream", async () => {
    const t = setup({ challenges: ["blink"] });
    const late = new FakeStream();
    let grant!: () => void;
    t.getUserMedia.mockImplementationOnce(() => new Promise((resolve) => (grant = () => resolve(asStream(late)))));
    const started = t.facialCheck.start().catch((e: unknown) => e);
    await flush();
    t.facialCheck.destroy();
    grant();
    await started;
    await flush();
    expect(late.tracks.every((track) => track.readyState === "ended")).toBe(true);
    expect(t.facialCheck.getStatus()).toBe("destroyed");
  });

  it("the camera disconnecting mid-session fails it with CAMERA_ERROR on the next frame", async () => {
    const t = setup({ challenges: ["blink"] });
    await t.facialCheck.start();
    await t.play(rep("neutral", 2));
    t.stream.tracks[0]?.end();
    expect(t.camera.isActive).toBe(false);
    await t.frames(1);
    expect(t.facialCheck.getStatus()).toBe("error");
    expect(t.of("error").map((e) => [e.error.code, e.fatal])).toEqual([["CAMERA_ERROR", true]]);
    await t.frames(3);
    expect(t.scheduler.queue.size).toBe(0);
    expect(t.of("completed")).toHaveLength(0);
  });

  it("destroy() before any start is safe and idempotent", () => {
    const t = setup();
    expect(() => {
      t.facialCheck.destroy();
      t.facialCheck.destroy();
    }).not.toThrow();
    expect(t.getUserMedia).not.toHaveBeenCalled();
    expect(t.facialCheck.getStatus()).toBe("destroyed");
  });
});
