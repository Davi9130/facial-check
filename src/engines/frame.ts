import type { FaceEngineInput, FaceImageSize } from "../types/face.types";

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the current frame can be read. */
const HAVE_CURRENT_DATA = 2;

export function isVideoElement(input: FaceEngineInput): input is HTMLVideoElement {
  return typeof HTMLVideoElement !== "undefined" && input instanceof HTMLVideoElement;
}

/** Frame size in pixels, or `null` when the frame has no pixels yet (e.g. video still loading). */
export function getImageSize(input: FaceEngineInput): FaceImageSize | null {
  let width: number;
  let height: number;
  if (isVideoElement(input)) {
    if (input.readyState < HAVE_CURRENT_DATA) return null;
    width = input.videoWidth;
    height = input.videoHeight;
  } else if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
    if (!input.complete) return null;
    width = input.naturalWidth;
    height = input.naturalHeight;
  } else {
    width = input.width;
    height = input.height;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}
