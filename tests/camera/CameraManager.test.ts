import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraManager } from "../../src/camera/CameraManager";
import { CameraError } from "../../src/camera/CameraErrors";
import { FakeStream, FakeTrack, asStream, createVideo, domError, mockMediaDevices, mockPermission } from "./mocks";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function startError(manager: CameraManager): Promise<CameraError> {
  try {
    await manager.start();
  } catch (error) {
    return error as CameraError;
  }
  throw new Error("start() should have failed");
}

beforeEach(() => {
  mockPermission(undefined);
  vi.stubGlobal("isSecureContext", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CameraManager.start", () => {
  it("requests the front camera and becomes active", async () => {
    const stream = new FakeStream();
    const md = mockMediaDevices(async () => asStream(stream));
    const manager = new CameraManager({ resolution: { width: 1280, height: 720 }, frameRate: 24 });

    expect(manager.status).toBe("idle");
    await expect(manager.start()).resolves.toBe(stream);

    expect(manager.status).toBe("active");
    expect(manager.isActive).toBe(true);
    expect(manager.stream).toBe(stream);
    expect(md.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24 },
      },
    });
    expect(manager.getSettings()).toEqual({ width: 640, height: 480, frameRate: 30, facingMode: "user" });
  });

  it("is idempotent while starting and once active", async () => {
    const md = mockMediaDevices(async () => asStream(new FakeStream()));
    const manager = new CameraManager();
    const [a, b] = await Promise.all([manager.start(), manager.start()]);
    expect(a).toBe(b);
    await manager.start();
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("falls back to any camera when constraints cannot be met", async () => {
    const fallback = new FakeStream();
    const md = mockMediaDevices(async (c) => {
      if (c.video === true) return asStream(fallback);
      throw domError("OverconstrainedError");
    });
    const manager = new CameraManager();
    await expect(manager.start()).resolves.toBe(fallback);
    expect(md.getUserMedia).toHaveBeenCalledTimes(2);
    expect(md.getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: true });
  });

  it("falls back when the requested deviceId does not exist", async () => {
    const md = mockMediaDevices(async (c) => {
      if (c.video === true) return asStream(new FakeStream());
      throw domError("NotFoundError");
    });
    await new CameraManager({ deviceId: "gone" }).start();
    expect(md.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when fallbackToAnyCamera is false", async () => {
    const md = mockMediaDevices(async () => {
      throw domError("OverconstrainedError", { constraint: "frameRate" });
    });
    const error = await startError(new CameraManager({ fallbackToAnyCamera: false }));
    expect(error.code).toBe("OVERCONSTRAINED");
    expect(error.constraint).toBe("frameRate");
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["NotAllowedError", "PERMISSION_DENIED"],
    ["NotFoundError", "NOT_FOUND"],
    ["NotReadableError", "NOT_READABLE"],
    ["WeirdError", "UNKNOWN"],
  ])("rejects %s from getUserMedia as %s", async (name, code) => {
    const md = mockMediaDevices(async () => {
      throw domError(name);
    });
    const manager = new CameraManager();
    const error = await startError(manager);
    expect(error).toBeInstanceOf(CameraError);
    expect(error.code).toBe(code);
    expect(manager.status).toBe("error");
    expect(manager.error).toBe(error);
    expect(manager.stream).toBeNull();
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("can retry after an error", async () => {
    let fail = true;
    mockMediaDevices(async () => {
      if (fail) throw domError("NotReadableError");
      return asStream(new FakeStream());
    });
    const manager = new CameraManager();
    await expect(manager.start()).rejects.toBeInstanceOf(CameraError);
    fail = false;
    await manager.start();
    expect(manager.status).toBe("active");
    expect(manager.error).toBeNull();
  });

  it("fails with INSECURE_CONTEXT outside a secure context", async () => {
    vi.stubGlobal("isSecureContext", false);
    const md = mockMediaDevices(async () => asStream(new FakeStream()));
    expect((await startError(new CameraManager())).code).toBe("INSECURE_CONTEXT");
    expect(md.getUserMedia).not.toHaveBeenCalled();
    expect(CameraManager.isSupported()).toBe(false);
  });

  it("fails with NOT_SUPPORTED without mediaDevices.getUserMedia", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect((await startError(new CameraManager())).code).toBe("NOT_SUPPORTED");
    expect(CameraManager.isSupported()).toBe(false);
  });

  it("uses an injected MediaDevices implementation", async () => {
    const getUserMedia = vi.fn(async () => asStream(new FakeStream()));
    const manager = new CameraManager({ mediaDevices: { getUserMedia } as unknown as MediaDevices });
    await manager.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("permissions", () => {
  it.each(["granted", "prompt", "denied"] as const)("reports %s from the Permissions API", async (state) => {
    mockPermission(state);
    await expect(new CameraManager().checkPermission()).resolves.toBe(state);
  });

  it("reports unknown when the API is missing or cannot query camera", async () => {
    mockPermission(undefined);
    await expect(new CameraManager().checkPermission()).resolves.toBe("unknown");
    mockPermission(new TypeError("camera is not a valid permission name"));
    await expect(new CameraManager().checkPermission()).resolves.toBe("unknown");
  });

  it("fails fast with PERMISSION_DENIED when permission is denied", async () => {
    mockPermission("denied");
    const md = mockMediaDevices(async () => asStream(new FakeStream()));
    expect((await startError(new CameraManager())).code).toBe("PERMISSION_DENIED");
    expect(md.getUserMedia).not.toHaveBeenCalled();
  });

  it("still asks the camera when permission state is unknown", async () => {
    mockPermission(new TypeError("unsupported"));
    const md = mockMediaDevices(async () => asStream(new FakeStream()));
    await new CameraManager().start();
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("resource release", () => {
  it("stop() stops every track and clears the video", async () => {
    const tracks = [new FakeTrack("video"), new FakeTrack("audio")];
    mockMediaDevices(async () => asStream(new FakeStream(tracks)));
    const manager = new CameraManager();
    const video = createVideo();
    await manager.start();
    await manager.attach(video);

    manager.stop();

    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(manager.stream).toBeNull();
    expect(manager.video).toBeNull();
    expect(manager.status).toBe("stopped");
    expect(manager.getSettings()).toBeNull();
  });

  it("stop() is safe to call repeatedly and before start", () => {
    const manager = new CameraManager();
    manager.stop();
    manager.stop();
    expect(manager.status).toBe("idle");
  });

  it("stop() during a pending start releases the late stream", async () => {
    const pending = deferred<MediaStream>();
    mockMediaDevices(() => pending.promise);
    const manager = new CameraManager();
    const starting = manager.start();
    expect(manager.status).toBe("starting");

    manager.stop();
    const stream = new FakeStream();
    pending.resolve(asStream(stream));

    await expect(starting).rejects.toBeInstanceOf(CameraError);
    expect(stream.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(manager.stream).toBeNull();
    expect(manager.status).toBe("stopped");
  });

  it("cleans up and calls onEnded when the track ends on its own", async () => {
    const stream = new FakeStream();
    mockMediaDevices(async () => asStream(stream));
    const onEnded = vi.fn();
    const manager = new CameraManager({ onEnded });
    const video = createVideo();
    await manager.attach(video);
    await manager.start();

    stream.tracks[0]?.end();

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(manager.status).toBe("stopped");
    expect(manager.stream).toBeNull();
    expect(video.srcObject).toBeNull();
  });
});

describe("attach", () => {
  it("binds the stream to a muted inline video and plays it", async () => {
    const stream = new FakeStream();
    mockMediaDevices(async () => asStream(stream));
    const manager = new CameraManager();
    await manager.start();
    const video = createVideo();

    await manager.attach(video);

    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it("attaching before start binds once the stream is ready", async () => {
    const stream = new FakeStream();
    mockMediaDevices(async () => asStream(stream));
    const manager = new CameraManager();
    const video = createVideo();
    await manager.attach(video);
    expect(video.srcObject ?? null).toBeNull();

    await manager.start();
    expect(video.srcObject).toBe(stream);
  });

  it("ignores AbortError from play()", async () => {
    mockMediaDevices(async () => asStream(new FakeStream()));
    const manager = new CameraManager();
    await manager.start();
    const video = createVideo();
    video.play = vi.fn(async () => {
      throw domError("AbortError");
    });
    await expect(manager.attach(video)).resolves.toBeUndefined();
  });

  it("detach() clears the video but keeps the camera running", async () => {
    const stream = new FakeStream();
    mockMediaDevices(async () => asStream(stream));
    const manager = new CameraManager();
    const video = createVideo();
    await manager.start();
    await manager.attach(video);

    manager.detach();

    expect(video.srcObject).toBeNull();
    expect(manager.isActive).toBe(true);
    expect(stream.tracks[0]?.stop).not.toHaveBeenCalled();
  });

  it("attaching another video releases the previous one", async () => {
    mockMediaDevices(async () => asStream(new FakeStream()));
    const manager = new CameraManager();
    await manager.start();
    const first = createVideo();
    const second = createVideo();
    await manager.attach(first);
    await manager.attach(second);
    expect(first.srcObject).toBeNull();
    expect(manager.video).toBe(second);
  });
});

describe("captureFrame", () => {
  function fakeContext() {
    return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
  }

  async function activeManager(video = createVideo()) {
    mockMediaDevices(async () => asStream(new FakeStream()));
    const manager = new CameraManager();
    await manager.start();
    await manager.attach(video);
    return { manager, video };
  }

  it("draws the current frame at the video size", async () => {
    const { manager, video } = await activeManager();
    const ctx = fakeContext();
    const canvas = document.createElement("canvas");
    canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement["getContext"];

    expect(manager.captureFrame({ canvas })).toBe(canvas);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 480);
    expect(ctx.scale).not.toHaveBeenCalled();
  });

  it("supports custom size and mirroring", async () => {
    const { manager } = await activeManager();
    const ctx = fakeContext();
    const canvas = document.createElement("canvas");
    canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement["getContext"];

    manager.captureFrame({ canvas, width: 320, height: 240, mirror: true });
    expect(canvas.width).toBe(320);
    expect(ctx.translate).toHaveBeenCalledWith(320, 0);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
  });

  it("creates a canvas when none is given", async () => {
    const { manager } = await activeManager();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(fakeContext() as unknown as CanvasRenderingContext2D);
    expect(manager.captureFrame()).toBeInstanceOf(HTMLCanvasElement);
    getContext.mockRestore();
  });

  it("throws NOT_READABLE when inactive, unattached or without frames", async () => {
    expect(() => new CameraManager().captureFrame()).toThrow(expect.objectContaining({ code: "NOT_READABLE" }));
    const { manager } = await activeManager(createVideo(0, 0));
    expect(() => manager.captureFrame()).toThrow(expect.objectContaining({ code: "NOT_READABLE" }));
  });

  it("throws NOT_SUPPORTED without a 2D context", async () => {
    const { manager } = await activeManager();
    const canvas = document.createElement("canvas");
    canvas.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
    expect(() => manager.captureFrame({ canvas })).toThrow(expect.objectContaining({ code: "NOT_SUPPORTED" }));
  });
});
