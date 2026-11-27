import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  readyState: "live" | "ended" = "live";
  readonly stop = vi.fn(() => {
    this.readyState = "ended";
  });
  constructor(
    readonly kind: "video" | "audio" = "video",
    private readonly settings: MediaTrackSettings = { width: 640, height: 480, frameRate: 30, facingMode: "user" },
  ) {
    super();
  }
  getSettings(): MediaTrackSettings {
    return this.settings;
  }
  /** Simulates the device going away. */
  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack()]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

export function domError(name: string, extra: Record<string, unknown> = {}): DOMException {
  return Object.assign(new DOMException("mock", name), extra);
}

export function asStream(stream: FakeStream): MediaStream {
  return stream as unknown as MediaStream;
}

/** Installs `navigator.mediaDevices` (and optionally `navigator.permissions`). */
export function mockMediaDevices(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const mediaDevices = { getUserMedia: vi.fn(getUserMedia) };
  Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });
  return mediaDevices;
}

export function mockPermission(state: PermissionState | Error | undefined) {
  const value =
    state === undefined
      ? undefined
      : {
          query: vi.fn(async () => {
            if (state instanceof Error) throw state;
            return { state };
          }),
        };
  Object.defineProperty(navigator, "permissions", { value, configurable: true });
}

export function createVideo(width = 640, height = 480): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  video.play = vi.fn(async () => undefined);
  video.pause = vi.fn();
  return video;
}
