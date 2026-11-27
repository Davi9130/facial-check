import type { CSSProperties, ReactNode, Ref } from "react";
import { cx, cssVar, sx } from "./styles";

export interface FaceCameraProps {
  /**
   * Ref of the `<video>`: pass the `videoRef` of `useFacialCheck`,
   * `useFaceCamera` or `useFaceDetection`.
   */
  videoRef?: Ref<HTMLVideoElement> | undefined;
  /** Mirror the preview like a selfie camera. Default: `true`. */
  mirrored?: boolean | undefined;
  /** Content drawn over the video (e.g. `<FaceGuide />`). */
  children?: ReactNode | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  videoClassName?: string | undefined;
  videoStyle?: CSSProperties | undefined;
  /** Drop the default inline styles (keep only `className` / `style`). */
  unstyled?: boolean | undefined;
  /** Accessible label of the preview. Default: `"Pré-visualização da câmera"`. */
  label?: string | undefined;
}

const containerStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "3 / 4",
  overflow: "hidden",
  borderRadius: cssVar.radius,
  background: "#000",
};

const videoBaseStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

/**
 * Camera preview. Purely visual: the camera itself is driven by a hook.
 *
 * ```tsx
 * const { videoRef, start } = useFaceCamera();
 * return <FaceCamera videoRef={videoRef}><FaceGuide /></FaceCamera>;
 * ```
 */
export function FaceCamera({
  videoRef,
  mirrored = true,
  children,
  className,
  style,
  videoClassName,
  videoStyle,
  unstyled,
  label = "Pré-visualização da câmera",
}: FaceCameraProps) {
  const mirror: CSSProperties = mirrored ? { transform: "scaleX(-1)" } : {};
  return (
    <div className={cx("fc-camera", className)} style={sx(containerStyle, style, unstyled)} data-mirrored={mirrored || undefined}>
      <video
        ref={videoRef}
        className={cx("fc-camera__video", videoClassName)}
        style={sx({ ...videoBaseStyle, ...mirror }, videoStyle, unstyled)}
        aria-label={label}
        autoPlay
        muted
        playsInline
      />
      {children}
    </div>
  );
}
