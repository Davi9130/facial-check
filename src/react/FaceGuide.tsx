import { useId, type CSSProperties } from "react";
import { cx, cssVar, sx } from "./styles";

/** Visual state of the face frame. */
export type FaceGuideState = "idle" | "searching" | "adjust" | "ready" | "success" | "error";

export interface FaceGuideProps {
  /** Default: `"idle"`. */
  state?: FaceGuideState | undefined;
  /** Progress of the current challenge (0 to 1), drawn around the frame. */
  progress?: number | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  unstyled?: boolean | undefined;
}

const COLORS: Record<FaceGuideState, string> = {
  idle: "rgba(255, 255, 255, 0.85)",
  searching: "rgba(255, 255, 255, 0.85)",
  adjust: cssVar.warning,
  ready: cssVar.primary,
  success: cssVar.success,
  error: cssVar.error,
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

// Oval in a 300×400 viewBox (same 3:4 ratio as the camera).
const CX = 150;
const CY = 190;
const RX = 105;
const RY = 140;
// Ramanujan approximation of the ellipse perimeter.
const PERIMETER = Math.PI * (3 * (RX + RY) - Math.sqrt((3 * RX + RY) * (RX + 3 * RY)));

// Same oval as a path starting at the top, so the progress grows clockwise from there.
const OVAL_FROM_TOP = `M ${CX} ${CY - RY} A ${RX} ${RY} 0 1 1 ${CX} ${CY + RY} A ${RX} ${RY} 0 1 1 ${CX} ${CY - RY}`;

/** Oval face frame drawn over the camera, colored by `state`. */
export function FaceGuide({ state = "idle", progress, className, style, unstyled }: FaceGuideProps) {
  const maskId = `fc-guide-mask-${useId().replace(/:/g, "")}`;
  const color = COLORS[state];
  const value = progress === undefined ? null : Math.min(1, Math.max(0, progress));
  return (
    <svg
      className={cx("fc-guide", className)}
      style={sx(overlayStyle, style, unstyled)}
      viewBox="0 0 300 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-state={state}
    >
      <defs>
        <mask id={maskId}>
          <rect width="300" height="400" fill="white" />
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="black" />
        </mask>
      </defs>
      <rect width="300" height="400" fill={cssVar.overlay} mask={`url(#${maskId})`} />
      <ellipse
        className="fc-guide__frame"
        cx={CX}
        cy={CY}
        rx={RX}
        ry={RY}
        fill="none"
        stroke={color}
        strokeWidth={state === "searching" ? 3 : 4}
        strokeDasharray={state === "searching" ? "10 8" : undefined}
      />
      {value !== null && value > 0 && (
        <path
          className="fc-guide__progress"
          d={OVAL_FROM_TOP}
          fill="none"
          stroke={cssVar.success}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${PERIMETER * value} ${PERIMETER}`}
          data-progress={value}
        />
      )}
    </svg>
  );
}
