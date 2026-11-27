import { useMemo } from "react";
import { CameraManager } from "../../camera/CameraManager";
import { CameraError, toCameraError } from "../../camera/CameraErrors";
import type {
  CameraOptions,
  CameraPermissionState,
  CameraStatus,
  CameraTrackSettings,
  CaptureFrameOptions,
} from "../../types/camera.types";
import { HookStore } from "./HookStore";
import { useHookStore } from "./useHookStore";

/**
 * Options of `useFaceCamera`. Camera options are read once, when the hook
 * creates its `CameraManager` (after mount); callbacks can change on every render.
 */
export interface UseFaceCameraOptions extends CameraOptions {
  /**
   * Use this camera instead of creating one. The hook does not stop it on
   * unmount (it only detaches its own `<video>`): its owner does.
   */
  camera?: CameraManager;
  /** Open the camera as soon as the component mounts. Default: `false`. */
  autoStart?: boolean;
  onStart?: (stream: MediaStream) => void;
  onError?: (error: CameraError) => void;
}

export interface FaceCameraState {
  status: CameraStatus;
  isActive: boolean;
  stream: MediaStream | null;
  /** Effective settings of the running track, or `null`. */
  settings: CameraTrackSettings | null;
  error: CameraError | null;
  /** `<video>` attached through `videoRef`, or `null`. */
  video: HTMLVideoElement | null;
  /** The underlying camera, `null` until the component is mounted. */
  camera: CameraManager | null;
}

export interface UseFaceCameraResult extends FaceCameraState {
  /** Attach to the `<video>` that shows the camera: `<video ref={videoRef} />`. */
  videoRef: (video: HTMLVideoElement | null) => void;
  /** Opens the camera. Resolves with the stream, or `null` on failure (see `error`). */
  start: () => Promise<MediaStream | null>;
  /** Stops every track. */
  stop: () => void;
  /** Current frame in a canvas (in memory only). @throws {CameraError} */
  captureFrame: (options?: CaptureFrameOptions) => HTMLCanvasElement;
  checkPermission: () => Promise<CameraPermissionState>;
}

const INITIAL: FaceCameraState = {
  status: "idle",
  isActive: false,
  stream: null,
  settings: null,
  error: null,
  video: null,
  camera: null,
};

export class FaceCameraStore extends HookStore<FaceCameraState, UseFaceCameraOptions> {
  private instance: CameraManager | null = null;
  private owned = false;
  private video: HTMLVideoElement | null = null;

  constructor(options: UseFaceCameraOptions) {
    super(options, INITIAL);
  }

  readonly videoRef = (video: HTMLVideoElement | null): void => {
    const previous = this.video;
    this.video = video;
    this.setState({ video });
    const camera = this.instance;
    if (!camera) return;
    if (video) void camera.attach(video).catch(() => undefined);
    else if (previous && camera.video === previous) camera.detach();
  };

  readonly start = async (): Promise<MediaStream | null> => {
    if (!this.ensureAcquired() || !this.instance) return null;
    const camera = this.instance;
    this.setState({ status: "starting", error: null });
    try {
      const stream = await camera.start();
      if (camera !== this.instance) return null;
      this.sync();
      this.options.onStart?.(stream);
      return stream;
    } catch (cause) {
      if (camera !== this.instance) return null;
      this.sync();
      const error = camera.error ?? toCameraError(cause);
      this.setState({ error });
      this.options.onError?.(error);
      return null;
    }
  };

  readonly stop = (): void => {
    if (!this.instance) return;
    this.instance.stop();
    this.sync();
  };

  readonly captureFrame = (options?: CaptureFrameOptions): HTMLCanvasElement => {
    if (!this.instance) throw new CameraError("NOT_READABLE", "Camera is not active or no <video> is attached.");
    return this.instance.captureFrame(options);
  };

  readonly checkPermission = (): Promise<CameraPermissionState> =>
    this.instance ? this.instance.checkPermission() : Promise.resolve("unknown");

  protected acquire(): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { camera: external, autoStart, onStart, onError, onEnded, ...cameraOptions } = this.options;
    let camera: CameraManager;
    if (external) {
      camera = external;
      this.owned = false;
    } else {
      camera = new CameraManager({
        ...cameraOptions,
        onEnded: () => {
          if (this.instance === camera) this.sync();
          this.options.onEnded?.();
        },
      });
      this.owned = true;
    }
    this.instance = camera;
    if (this.video) void camera.attach(this.video).catch(() => undefined);
    this.setState({ camera });
    this.sync();
    if (autoStart) void this.start();
  }

  protected release(): void {
    const camera = this.instance;
    this.instance = null;
    if (camera) {
      if (this.owned) camera.stop();
      else if (this.video && camera.video === this.video) camera.detach();
    }
    this.setState({ ...INITIAL, video: this.video });
  }

  private sync(): void {
    const camera = this.instance;
    if (!camera) return;
    this.setState({
      status: camera.status,
      isActive: camera.isActive,
      stream: camera.stream,
      settings: camera.isActive ? camera.getSettings() : null,
      error: camera.error,
    });
  }
}

/**
 * Front camera for the component: open / stop it and show it in a `<video>`.
 *
 * ```tsx
 * const { videoRef, start, stop, isActive, error } = useFaceCamera({ resolution: { width: 1280, height: 720 } });
 * return <video ref={videoRef} />;
 * ```
 *
 * Every track is stopped on unmount (unless an external `camera` was given).
 */
export function useFaceCamera(options: UseFaceCameraOptions = {}): UseFaceCameraResult {
  const [store, state] = useHookStore((o: UseFaceCameraOptions) => new FaceCameraStore(o), options);
  return useMemo(
    () => ({
      ...state,
      videoRef: store.videoRef,
      start: store.start,
      stop: store.stop,
      captureFrame: store.captureFrame,
      checkPermission: store.checkPermission,
    }),
    [state, store],
  );
}
