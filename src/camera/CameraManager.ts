import type {
  CameraConfig,
  CameraOptions,
  CameraPermissionState,
  CameraStatus,
  CameraTrackSettings,
  CaptureFrameOptions,
} from "../types/camera.types";
import { buildFallbackConstraints, buildVideoConstraints, resolveCameraConfig } from "./CameraConfig";
import { CameraError, toCameraError } from "./CameraErrors";

/**
 * Framework-agnostic camera lifecycle: request the (front) camera, attach it
 * to a `<video>`, grab frames into a canvas, and release every resource on `stop()`.
 *
 * Frames never leave the browser: nothing is uploaded, stored or logged.
 */
export class CameraManager {
  readonly config: Readonly<CameraConfig>;

  private readonly mediaDevicesOverride: MediaDevices | undefined;
  private readonly onEnded: (() => void) | undefined;
  private currentStatus: CameraStatus = "idle";
  private currentStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private pendingStart: Promise<MediaStream> | null = null;
  /** Bumped by `stop()` so a start that resolves late knows it was cancelled. */
  private generation = 0;
  private lastError: CameraError | null = null;

  constructor(options: CameraOptions = {}) {
    this.config = Object.freeze(resolveCameraConfig(options));
    this.mediaDevicesOverride = options.mediaDevices;
    this.onEnded = options.onEnded;
  }

  get status(): CameraStatus {
    return this.currentStatus;
  }

  get stream(): MediaStream | null {
    return this.currentStream;
  }

  get isActive(): boolean {
    return this.currentStatus === "active";
  }

  /** Last error raised by `start()`, or `null`. */
  get error(): CameraError | null {
    return this.lastError;
  }

  /** `<video>` currently attached, or `null`. */
  get video(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /** Whether this environment can capture video at all (secure context + `getUserMedia`). */
  static isSupported(): boolean {
    return isSecure() && typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";
  }

  /**
   * Current camera permission via the Permissions API. Returns `"unknown"` when
   * the API is missing or the browser cannot query `camera` (e.g. older Firefox/Safari).
   */
  async checkPermission(): Promise<CameraPermissionState> {
    const permissions = globalThis.navigator?.permissions;
    if (typeof permissions?.query !== "function") return "unknown";
    try {
      const result = await permissions.query({ name: "camera" as PermissionName });
      return result.state;
    } catch {
      return "unknown";
    }
  }

  /**
   * Opens the camera. Idempotent: returns the running stream if already active,
   * or the in-flight promise if a start is pending.
   *
   * @throws {CameraError}
   */
  start(): Promise<MediaStream> {
    if (this.currentStream !== null && this.currentStatus === "active") {
      return Promise.resolve(this.currentStream);
    }
    if (this.pendingStart !== null) return this.pendingStart;

    const generation = this.generation;
    this.currentStatus = "starting";
    this.lastError = null;

    const pending = this.open(generation).finally(() => {
      if (this.pendingStart === pending) this.pendingStart = null;
    });
    this.pendingStart = pending;
    return pending;
  }

  /** Stops every track, clears the attached `<video>` and returns to `"stopped"`. */
  stop(): void {
    this.generation += 1;
    this.pendingStart = null;
    this.releaseStream();
    this.clearVideo();
    if (this.currentStatus !== "idle") this.currentStatus = "stopped";
  }

  /**
   * Shows the camera in `video`. Can be called before `start()`: the stream is
   * attached as soon as it is available. The element is muted and inline so
   * autoplay works on mobile browsers.
   */
  async attach(video: HTMLVideoElement): Promise<void> {
    if (this.videoElement !== null && this.videoElement !== video) this.clearVideo();
    this.videoElement = video;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    if (this.currentStream !== null) await this.bindVideo(video, this.currentStream);
  }

  /** Detaches the `<video>` (clears `srcObject`) without stopping the camera. */
  detach(): void {
    this.clearVideo();
  }

  /** Effective settings of the running video track, or `null` when inactive. */
  getSettings(): CameraTrackSettings | null {
    const track = this.currentStream?.getVideoTracks()[0];
    if (track === undefined) return null;
    const s = track.getSettings();
    const settings: CameraTrackSettings = {};
    if (s.width !== undefined) settings.width = s.width;
    if (s.height !== undefined) settings.height = s.height;
    if (s.frameRate !== undefined) settings.frameRate = s.frameRate;
    if (s.facingMode !== undefined) settings.facingMode = s.facingMode;
    if (s.deviceId !== undefined) settings.deviceId = s.deviceId;
    return settings;
  }

  /**
   * Draws the current video frame into a canvas (the given one, or a new one)
   * and returns it. Requires an active camera and an attached `<video>`.
   *
   * @throws {CameraError} `NOT_READABLE` when no frame is available yet,
   *   `NOT_SUPPORTED` when a 2D canvas context cannot be created.
   */
  captureFrame(options: CaptureFrameOptions = {}): HTMLCanvasElement {
    const video = this.videoElement;
    if (!this.isActive || video === null) {
      throw new CameraError("NOT_READABLE", "Camera is not active or no <video> is attached.");
    }
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth === 0 || sourceHeight === 0) {
      throw new CameraError("NOT_READABLE", "No video frame is available yet.");
    }

    const width = options.width ?? sourceWidth;
    const height = options.height ?? sourceHeight;
    const canvas = options.canvas ?? document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (context === null) {
      throw new CameraError("NOT_SUPPORTED", "Could not create a 2D canvas context.");
    }
    context.save();
    if (options.mirror === true) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, width, height);
    context.restore();
    return canvas;
  }

  private async open(generation: number): Promise<MediaStream> {
    try {
      const mediaDevices = this.resolveMediaDevices();
      if ((await this.checkPermission()) === "denied") {
        throw new CameraError("PERMISSION_DENIED");
      }
      const stream = await this.request(mediaDevices);

      if (generation !== this.generation) {
        // stop() was called while getUserMedia was pending.
        stopTracks(stream);
        throw new CameraError("UNKNOWN", "Camera start was cancelled by stop().");
      }

      this.currentStream = stream;
      this.currentStatus = "active";
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", this.handleTrackEnded);
      }
      if (this.videoElement !== null) await this.bindVideo(this.videoElement, stream);
      return stream;
    } catch (error) {
      const cameraError = toCameraError(error);
      if (generation === this.generation) {
        this.lastError = cameraError;
        this.currentStatus = "error";
      }
      throw cameraError;
    }
  }

  /** Preferred constraints first; falls back to any camera when they cannot be met. */
  private async request(mediaDevices: MediaDevices): Promise<MediaStream> {
    try {
      return await mediaDevices.getUserMedia(buildVideoConstraints(this.config));
    } catch (error) {
      const cameraError = toCameraError(error);
      const canFallback =
        this.config.fallbackToAnyCamera &&
        (cameraError.code === "OVERCONSTRAINED" ||
          (cameraError.code === "NOT_FOUND" && this.config.deviceId !== undefined));
      if (!canFallback) throw cameraError;
      return mediaDevices.getUserMedia(buildFallbackConstraints());
    }
  }

  private resolveMediaDevices(): MediaDevices {
    if (this.mediaDevicesOverride !== undefined) return this.mediaDevicesOverride;
    if (!isSecure()) throw new CameraError("INSECURE_CONTEXT");
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function") throw new CameraError("NOT_SUPPORTED");
    return mediaDevices;
  }

  private async bindVideo(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
    if (video.srcObject !== stream) video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      // play() is interrupted when the source changes or stop() runs; that is not a failure.
      if (!(typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) {
        throw toCameraError(error);
      }
    }
  }

  private readonly handleTrackEnded = (): void => {
    if (this.currentStream === null) return;
    this.stop();
    this.onEnded?.();
  };

  private releaseStream(): void {
    const stream = this.currentStream;
    this.currentStream = null;
    if (stream === null) return;
    for (const track of stream.getTracks()) {
      track.removeEventListener("ended", this.handleTrackEnded);
    }
    stopTracks(stream);
  }

  private clearVideo(): void {
    const video = this.videoElement;
    this.videoElement = null;
    if (video === null) return;
    video.pause();
    video.srcObject = null;
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function isSecure(): boolean {
  // `isSecureContext` is undefined outside browsers; treat that as secure and
  // let the `mediaDevices` check decide.
  return globalThis.isSecureContext !== false;
}
