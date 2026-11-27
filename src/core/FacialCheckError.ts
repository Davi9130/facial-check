import type { FacialCheckErrorCode, FacialCheckErrorInfo } from "../types/session.types";

/** Error raised (and emitted) by `FacialCheck`. Messages never contain image or biometric data. */
export class FacialCheckError extends Error {
  override readonly name = "FacialCheckError";
  readonly code: FacialCheckErrorCode;

  constructor(code: FacialCheckErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }

  toJSON(): FacialCheckErrorInfo {
    return { code: this.code, message: this.message };
  }
}

export function isFacialCheckError(error: unknown): error is FacialCheckError {
  return error instanceof FacialCheckError;
}
