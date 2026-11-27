import type { CameraErrorCode } from "../types/camera.types";

const DEFAULT_MESSAGES: Record<CameraErrorCode, string> = {
  PERMISSION_DENIED: "Camera permission was denied.",
  NOT_FOUND: "No camera matching the request was found.",
  NOT_READABLE: "The camera could not be read; it may be in use by another application.",
  OVERCONSTRAINED: "No camera satisfies the requested constraints.",
  INSECURE_CONTEXT: "Camera access requires a secure context (HTTPS or localhost).",
  NOT_SUPPORTED: "This environment does not support camera capture.",
  UNKNOWN: "An unknown camera error occurred.",
};

/** Error thrown by the camera module. Always carries a standardized `code`. */
export class CameraError extends Error {
  override readonly name = "CameraError";
  readonly code: CameraErrorCode;
  /** For `OVERCONSTRAINED`: the constraint the browser could not satisfy, if reported. */
  readonly constraint: string | undefined;

  constructor(code: CameraErrorCode, message?: string, options?: { cause?: unknown; constraint?: string }) {
    super(message ?? DEFAULT_MESSAGES[code], options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.constraint = options?.constraint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isCameraError(error: unknown): error is CameraError {
  return error instanceof CameraError;
}

/** `DOMException` names (current and legacy) mapped to error codes. */
const NAME_TO_CODE: Record<string, CameraErrorCode> = {
  NotAllowedError: "PERMISSION_DENIED",
  PermissionDeniedError: "PERMISSION_DENIED",
  SecurityError: "PERMISSION_DENIED",
  NotFoundError: "NOT_FOUND",
  DevicesNotFoundError: "NOT_FOUND",
  NotReadableError: "NOT_READABLE",
  TrackStartError: "NOT_READABLE",
  AbortError: "NOT_READABLE",
  OverconstrainedError: "OVERCONSTRAINED",
  ConstraintNotSatisfiedError: "OVERCONSTRAINED",
  NotSupportedError: "NOT_SUPPORTED",
};

/**
 * Converts anything thrown by `getUserMedia` (usually a `DOMException`, or an
 * `OverconstrainedError` in some browsers) into a `CameraError`.
 */
export function toCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;

  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  const code = NAME_TO_CODE[name] ?? "UNKNOWN";
  const constraint =
    typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string"
      ? error.constraint
      : undefined;

  return new CameraError(code, undefined, constraint === undefined ? { cause: error } : { cause: error, constraint });
}
