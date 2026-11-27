/**
 * Public types of the camera module (`src/camera`).
 */

/** Which physical camera to prefer. `"user"` is the front (selfie) camera. */
export type CameraFacingMode = "user" | "environment";

export interface CameraResolution {
  width: number;
  height: number;
}

/** Standardized camera error codes. */
export type CameraErrorCode =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "NOT_READABLE"
  | "OVERCONSTRAINED"
  | "INSECURE_CONTEXT"
  | "NOT_SUPPORTED"
  | "UNKNOWN";

/** Lifecycle of a `CameraManager`. */
export type CameraStatus = "idle" | "starting" | "active" | "stopped" | "error";

/**
 * Camera permission as reported by the Permissions API.
 * `"unknown"` means the browser cannot tell (API missing or `camera` not queryable).
 */
export type CameraPermissionState = "granted" | "denied" | "prompt" | "unknown";

export interface CameraOptions {
  /** Preferred camera. Default: `"user"` (front camera). */
  facingMode?: CameraFacingMode;
  /** Ideal capture resolution. Default: 640x480. */
  resolution?: CameraResolution;
  /** Ideal frames per second. Default: 30. */
  frameRate?: number;
  /** Upper bound for frames per second. Default: none. */
  maxFrameRate?: number;
  /** Use one specific device (from `enumerateDevices`) instead of `facingMode`. */
  deviceId?: string;
  /**
   * When the preferred constraints cannot be satisfied (or the requested
   * device does not exist), retry with any available camera. Default: `true`.
   */
  fallbackToAnyCamera?: boolean;
  /** Called when the camera stops on its own (device unplugged, revoked, ...). */
  onEnded?: () => void;
  /**
   * `MediaDevices` implementation to use. Default: `navigator.mediaDevices`.
   * Mainly useful for tests and non-standard environments.
   */
  mediaDevices?: MediaDevices;
}

/** Resolved configuration with every default applied. */
export interface CameraConfig {
  facingMode: CameraFacingMode;
  resolution: CameraResolution;
  frameRate: number;
  maxFrameRate: number | undefined;
  deviceId: string | undefined;
  fallbackToAnyCamera: boolean;
}

/** Effective settings of the running video track. */
export interface CameraTrackSettings {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
  deviceId?: string;
}

export interface CaptureFrameOptions {
  /** Canvas to draw into. A new one is created when omitted. */
  canvas?: HTMLCanvasElement;
  /** Output width. Default: the video's intrinsic width. */
  width?: number;
  /** Output height. Default: the video's intrinsic height. */
  height?: number;
  /** Flip horizontally (selfie preview). Default: `false`. */
  mirror?: boolean;
}
