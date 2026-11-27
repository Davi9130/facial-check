import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraManager } from "../../src/camera/CameraManager";
import { useFaceCamera } from "../../src/react";
import { FakeStream, asStream, domError } from "../camera/mocks";
import { settle } from "./helpers";

function media() {
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => asStream(stream));
  return { stream, getUserMedia, mediaDevices: { getUserMedia } as unknown as MediaDevices };
}

afterEach(() => vi.restoreAllMocks());

describe("useFaceCamera", () => {
  it("opens the camera, exposes the stream and stops it", async () => {
    const m = media();
    const onStart = vi.fn();
    const { result } = renderHook(() => useFaceCamera({ mediaDevices: m.mediaDevices, onStart }));
    await settle();
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("active");
    expect(result.current.isActive).toBe(true);
    expect(result.current.stream).not.toBeNull();
    expect(result.current.settings?.width).toBe(640);
    expect(onStart).toHaveBeenCalledTimes(1);

    act(() => result.current.stop());
    expect(result.current.isActive).toBe(false);
    expect(m.stream.tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });

  it("opens the camera once under StrictMode and stops every track on unmount", async () => {
    const m = media();
    const { result, unmount } = renderHook(() => useFaceCamera({ mediaDevices: m.mediaDevices, autoStart: true }), {
      wrapper: StrictMode,
    });
    await settle();
    expect(m.getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.isActive).toBe(true);
    const camera = result.current.camera;
    unmount();
    expect(camera?.isActive).toBe(false);
    expect(m.stream.tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });

  it("shows the camera in the <video> given to videoRef", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const m = media();
    let video: HTMLVideoElement | null = null;
    function Preview() {
      const camera = useFaceCamera({ mediaDevices: m.mediaDevices, autoStart: true });
      video = camera.video;
      return <video ref={camera.videoRef} />;
    }
    const { container } = render(<Preview />);
    await settle();
    const element = container.querySelector("video");
    expect(video).toBe(element);
    expect(element?.srcObject).toBe(asStream(m.stream));
  });

  it("reports camera errors in error / onError without throwing", async () => {
    const m = media();
    m.getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
    const onError = vi.fn();
    const { result } = renderHook(() => useFaceCamera({ mediaDevices: m.mediaDevices, onError }));
    await settle();
    let stream: MediaStream | null = asStream(m.stream);
    await act(async () => {
      stream = await result.current.start();
    });
    expect(stream).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("PERMISSION_DENIED");
    expect(onError).toHaveBeenCalledWith(result.current.error);
  });

  it("does not stop an external camera on unmount", async () => {
    const m = media();
    const camera = new CameraManager({ mediaDevices: m.mediaDevices });
    await camera.start();
    const { result, unmount } = renderHook(() => useFaceCamera({ camera }));
    await settle();
    expect(result.current.camera).toBe(camera);
    expect(result.current.isActive).toBe(true);
    unmount();
    expect(camera.isActive).toBe(true);
    camera.stop();
  });
});
