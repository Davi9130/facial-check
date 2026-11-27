import type { CSSProperties } from "react";
import { cssVar, cx, sx } from "./styles";
import { formatText, resolveTexts, type LivenessTextsInput } from "./texts";

export interface LivenessProgressProps {
  /** Overall progress, from 0 to 100. */
  progress: number;
  /** Challenges of the session (shows the "Etapa x de y" label and the step dots). */
  total?: number | undefined;
  /** Challenges completed so far. */
  completed?: number | undefined;
  /** Show the step label. Default: `true` when `total` is given. */
  showSteps?: boolean | undefined;
  texts?: LivenessTextsInput | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  unstyled?: boolean | undefined;
}

const clamp = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

/** Progress bar of the liveness session. */
export function LivenessProgress({
  progress,
  total,
  completed = 0,
  showSteps,
  texts,
  className,
  style,
  unstyled,
}: LivenessProgressProps) {
  const t = resolveTexts(texts);
  const percent = Math.round(clamp(progress));
  const steps = showSteps ?? total !== undefined;
  const current = total ? Math.min(total, completed + (percent >= 100 ? 0 : 1)) : 0;

  return (
    <div className={cx("fc-progress", className)} style={sx({ width: "100%" }, style, unstyled)}>
      {steps && total ? (
        <p
          className="fc-progress__label"
          style={unstyled ? undefined : { margin: "0 0 0.375rem", fontSize: "0.875rem", color: cssVar.muted, textAlign: "center" }}
        >
          {formatText(t.step, { current, total })}
        </p>
      ) : null}
      <div
        className="fc-progress__track"
        role="progressbar"
        aria-label={t.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={unstyled ? undefined : { height: "8px", borderRadius: "999px", background: cssVar.track, overflow: "hidden" }}
      >
        <div
          className="fc-progress__bar"
          style={{
            width: `${percent}%`,
            ...(unstyled
              ? {}
              : { height: "100%", borderRadius: "inherit", background: cssVar.success, transition: "width 200ms ease-out" }),
          }}
        />
      </div>
    </div>
  );
}
