import { describe, expect, it } from "vitest";
import { CameraError, isCameraError, toCameraError } from "../../src/camera/CameraErrors";
import { domError } from "./mocks";

describe("toCameraError", () => {
  it.each([
    ["NotAllowedError", "PERMISSION_DENIED"],
    ["PermissionDeniedError", "PERMISSION_DENIED"],
    ["SecurityError", "PERMISSION_DENIED"],
    ["NotFoundError", "NOT_FOUND"],
    ["DevicesNotFoundError", "NOT_FOUND"],
    ["NotReadableError", "NOT_READABLE"],
    ["TrackStartError", "NOT_READABLE"],
    ["AbortError", "NOT_READABLE"],
    ["OverconstrainedError", "OVERCONSTRAINED"],
    ["ConstraintNotSatisfiedError", "OVERCONSTRAINED"],
    ["NotSupportedError", "NOT_SUPPORTED"],
    ["SomethingElse", "UNKNOWN"],
  ])("maps DOMException %s to %s", (name, code) => {
    const source = domError(name);
    const error = toCameraError(source);
    expect(error).toBeInstanceOf(CameraError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.name).toBe("CameraError");
    expect(error.cause).toBe(source);
  });

  it("keeps the failing constraint of an OverconstrainedError", () => {
    const error = toCameraError({ name: "OverconstrainedError", constraint: "width" });
    expect(error.code).toBe("OVERCONSTRAINED");
    expect(error.constraint).toBe("width");
  });

  it("maps non-error values to UNKNOWN", () => {
    expect(toCameraError("boom").code).toBe("UNKNOWN");
    expect(toCameraError(undefined).code).toBe("UNKNOWN");
  });

  it("returns CameraError instances unchanged", () => {
    const error = new CameraError("NOT_FOUND");
    expect(toCameraError(error)).toBe(error);
    expect(isCameraError(error)).toBe(true);
    expect(isCameraError(new Error("x"))).toBe(false);
  });
});
