import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isCameraError } from "../camera/CameraErrors";
import type { FaceAnalysis, FaceAnalysisIssue } from "../types/analysis.types";
import type { ChallengeCompletedEvent, ChallengeFailedEvent } from "../types/challenge.types";
import type { FacialCheckResult } from "../types/session.types";
import { ChallengeInstructions, type ChallengeFeedback } from "./ChallengeInstructions";
import { FaceCamera } from "./FaceCamera";
import { FaceGuide, type FaceGuideState } from "./FaceGuide";
import { useFacialCheck, type FacialCheckHookError, type UseFacialCheckOptions, type UseFacialCheckResult } from "./hooks";
import { LivenessProgress } from "./LivenessProgress";
import { buttonStyle, cssVar, cx, sx } from "./styles";
import { resolveTexts, type LivenessTexts, type LivenessTextsInput } from "./texts";

/** Screen shown by `FaceLiveness`, exposed as `data-phase` on the root element. */
export type LivenessPhase = "start" | "loading" | "capture" | "analyzing" | "success" | "failure" | "error";

/** Everything a render prop receives. */
export interface FaceLivenessRenderState extends UseFacialCheckResult {
  phase: LivenessPhase;
  /** Live face issues of the last frame. */
  liveIssues: readonly FaceAnalysisIssue[];
  feedback: ChallengeFeedback;
  texts: LivenessTexts;
  /** Starts a new session (same as `start`). */
  retry: () => Promise<void>;
}

/** Class names of the inner parts, for CSS customization. */
export interface FaceLivenessClassNames {
  camera?: string | undefined;
  guide?: string | undefined;
  instructions?: string | undefined;
  progress?: string | undefined;
  overlay?: string | undefined;
  actions?: string | undefined;
  button?: string | undefined;
}

export interface FaceLivenessProps extends UseFacialCheckOptions {
  /** Texts shown to the user (pt-BR by default). */
  texts?: LivenessTextsInput | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  classNames?: FaceLivenessClassNames | undefined;
  /** Drop the default inline styles: style everything from `className` / `classNames`. */
  unstyled?: boolean | undefined;
  /** Mirror the camera preview. Default: `true`. */
  mirrored?: boolean | undefined;
  /** Show the progress bar. Default: `true`. */
  showProgress?: boolean | undefined;
  /** How long the per-challenge feedback stays visible, in ms. Default: `900`. */
  feedbackMs?: number | undefined;
  /** Replaces the start screen content (shown before the first session). */
  renderStart?: (state: FaceLivenessRenderState) => ReactNode;
  /** Replaces the success screen content. */
  renderSuccess?: (result: FacialCheckResult, state: FaceLivenessRenderState) => ReactNode;
  /** Replaces the failure screen content (a challenge failed). */
  renderFailure?: (result: FacialCheckResult | null, state: FaceLivenessRenderState) => ReactNode;
  /** Replaces the error screen content (camera, engine, …). */
  renderError?: (error: FacialCheckHookError | null, state: FaceLivenessRenderState) => ReactNode;
  /** Replaces the loading content. */
  renderLoading?: (state: FaceLivenessRenderState) => ReactNode;
  /** Extra content drawn over the camera (e.g. a custom guide). */
  children?: (state: FaceLivenessRenderState) => ReactNode;
}

/** Message of an error, using the configured texts. Permission denied has its own message. */
export function getErrorMessage(error: FacialCheckHookError | null, texts: LivenessTexts = resolveTexts()): string {
  if (!error) return texts.genericError;
  if (error.code === "CAMERA_ERROR") {
    const cause = isCameraError(error.cause) ? error.cause : null;
    if (cause?.code === "PERMISSION_DENIED") return texts.permissionDenied;
    if (cause?.code === "NOT_FOUND") return texts.cameraNotFound;
    return texts.cameraError;
  }
  if (error.code === "ENGINE_ERROR") return texts.engineError;
  return texts.genericError;
}

/** Whether the error comes from a denied camera permission. */
export function isPermissionDenied(error: FacialCheckHookError | null): boolean {
  return !!error && error.code === "CAMERA_ERROR" && isCameraError(error.cause) && error.cause.code === "PERMISSION_DENIED";
}

function toPhase(state: UseFacialCheckResult): LivenessPhase {
  switch (state.status) {
    case "initializing":
    case "starting":
      return "loading";
    case "waiting-face":
    case "running":
      return "capture";
    case "analyzing-pad":
      return "analyzing";
    case "completed":
      return "success";
    case "failed":
      return "failure";
    case "error":
      return "error";
    default:
      return state.error ? "error" : "start";
  }
}

const BLOCKING: readonly FaceAnalysisIssue[] = ["no-face", "multiple-faces", "partially-visible"];

function toGuideState(phase: LivenessPhase, state: UseFacialCheckResult, issues: readonly FaceAnalysisIssue[], feedback: ChallengeFeedback): FaceGuideState {
  if (phase === "success") return "success";
  if (phase === "failure" || phase === "error") return "error";
  if (phase !== "capture") return "idle";
  if (feedback === "done") return "success";
  if (!state.faceDetected || issues.includes("no-face")) return "searching";
  if (state.status === "waiting-face") return issues.length > 0 ? "adjust" : "ready";
  return issues.some((i) => BLOCKING.includes(i)) ? "adjust" : "ready";
}

const sameIssues = (a: readonly FaceAnalysisIssue[], b: readonly FaceAnalysisIssue[]) =>
  a.length === b.length && a.every((issue, i) => issue === b[i]);

/**
 * Complete Face Liveness flow: camera preview, face frame, dynamic
 * instructions, progress, per-challenge feedback, loading and error states.
 *
 * ```tsx
 * <FaceLiveness
 *   challenges={["blink", "open-mouth", "turn-left", "turn-right"]}
 *   randomChallenges
 *   onSuccess={(result) => console.log(result)}
 *   onError={(error) => console.error(error)}
 * />
 * ```
 *
 * The configuration (challenges, engine, camera…) is read when the component
 * mounts; change its `key` to apply a new one. Callbacks can change freely.
 */
export function FaceLiveness(props: FaceLivenessProps) {
  const {
    texts: textsInput,
    className,
    style,
    classNames = {},
    unstyled,
    mirrored = true,
    showProgress = true,
    feedbackMs = 900,
    renderStart,
    renderSuccess,
    renderFailure,
    renderError,
    renderLoading,
    children,
    ...options
  } = props;
  const texts = useMemo(() => resolveTexts(textsInput), [textsInput]);

  const [liveIssues, setLiveIssues] = useState<readonly FaceAnalysisIssue[]>([]);
  const [feedback, setFeedback] = useState<ChallengeFeedback>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback(
    (value: Exclude<ChallengeFeedback, null>, ms: number) => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      setFeedback(value);
      feedbackTimer.current = setTimeout(() => {
        feedbackTimer.current = null;
        setFeedback(null);
      }, ms);
    },
    [],
  );
  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  const { onFrame, onChallengeCompleted, onChallengeFailed } = options;
  const state = useFacialCheck({
    ...options,
    onFrame: (analysis: FaceAnalysis) => {
      // Re-render only when the issues change, not on every frame.
      setLiveIssues((prev) => (sameIssues(prev, analysis.issues) ? prev : analysis.issues));
      onFrame?.(analysis);
    },
    onChallengeCompleted: (event: ChallengeCompletedEvent) => {
      showFeedback("done", feedbackMs);
      onChallengeCompleted?.(event);
    },
    onChallengeFailed: (event: ChallengeFailedEvent) => {
      if (event.willRetry) showFeedback("retry", feedbackMs * 2);
      onChallengeFailed?.(event);
    },
  });

  const phase = toPhase(state);
  const issues = phase === "capture" ? liveIssues : [];
  const renderState: FaceLivenessRenderState = { ...state, phase, liveIssues: issues, feedback, texts, retry: state.start };
  const guideState = toGuideState(phase, state, issues, feedback);
  const challengeProgress = state.challenge?.status === "active" ? state.challenge.progress : undefined;

  const start = () => {
    setLiveIssues([]);
    setFeedback(null);
    void state.start();
  };

  const button = (label: string) => (
    <button type="button" className={cx("fc-liveness__button", classNames.button)} style={sx(buttonStyle, undefined, unstyled)} onClick={start}>
      {label}
    </button>
  );

  const overlay = (content: ReactNode, tone: "neutral" | "success" | "error" = "neutral") => (
    <div
      className={cx("fc-liveness__overlay", classNames.overlay)}
      data-tone={tone}
      style={sx(
        {
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          color: "#fff",
          background: cssVar.overlay,
        },
        undefined,
        unstyled,
      )}
    >
      {content}
    </div>
  );

  let cameraOverlay: ReactNode = null;
  let below: ReactNode = null;

  switch (phase) {
    case "start":
      below = renderStart ? (
        renderStart(renderState)
      ) : (
        <>
          <p className="fc-liveness__description" style={unstyled ? undefined : { margin: 0, textAlign: "center", color: cssVar.muted }}>
            {state.status === "stopped" ? texts.stopped : texts.description}
          </p>
          {button(state.status === "stopped" ? texts.retry : texts.start)}
        </>
      );
      break;
    case "loading":
      cameraOverlay = overlay(
        renderLoading ? (
          renderLoading(renderState)
        ) : (
          <>
            <Spinner unstyled={unstyled} />
            <span>{state.status === "starting" ? texts.openingCamera : texts.loading}</span>
          </>
        ),
      );
      break;
    case "capture":
      below = (
        <>
          <ChallengeInstructions
            className={classNames.instructions}
            status={state.status}
            challenge={state.currentChallenge}
            faceIssues={issues}
            feedback={feedback}
            texts={textsInput}
            unstyled={unstyled}
          />
          {showProgress && (
            <LivenessProgress
              className={classNames.progress}
              progress={state.progress}
              total={state.progressDetails?.total}
              completed={state.progressDetails?.completed}
              showSteps={state.progressDetails !== null}
              texts={textsInput}
              unstyled={unstyled}
            />
          )}
        </>
      );
      break;
    case "analyzing":
      cameraOverlay = overlay(
        <>
          <Spinner unstyled={unstyled} />
          <span>{texts.analyzing}</span>
        </>,
      );
      break;
    case "success":
      cameraOverlay = overlay(<strong style={{ fontSize: "1.25rem" }}>{texts.success}</strong>, "success");
      below = state.result && renderSuccess ? renderSuccess(state.result, renderState) : null;
      break;
    case "failure":
      cameraOverlay = overlay(<strong style={{ fontSize: "1.125rem" }}>{texts.failure}</strong>, "error");
      below = renderFailure ? renderFailure(state.result, renderState) : button(texts.retry);
      break;
    case "error":
      cameraOverlay = overlay(
        <span role="alert" className="fc-liveness__error" data-permission-denied={isPermissionDenied(state.error) || undefined}>
          {getErrorMessage(state.error, texts)}
        </span>,
        "error",
      );
      below = renderError ? renderError(state.error, renderState) : button(texts.retry);
      break;
  }

  const rootStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    width: "100%",
    maxWidth: cssVar.maxWidth,
    marginInline: "auto",
    boxSizing: "border-box",
    padding: "1rem",
    fontFamily: cssVar.font,
    color: cssVar.text,
    background: cssVar.background,
  };

  return (
    <section className={cx("fc-liveness", className)} style={sx(rootStyle, style, unstyled)} data-phase={phase} data-status={state.status} aria-label={texts.title}>
      <FaceCamera videoRef={state.videoRef} mirrored={mirrored} className={classNames.camera} unstyled={unstyled}>
        <FaceGuide state={guideState} progress={challengeProgress} className={classNames.guide} unstyled={unstyled} />
        {cameraOverlay}
        {children?.(renderState)}
      </FaceCamera>
      {below !== null && (
        <div
          className={cx("fc-liveness__actions", classNames.actions)}
          style={sx({ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", width: "100%" }, undefined, unstyled)}
        >
          {below}
        </div>
      )}
    </section>
  );
}

function Spinner({ unstyled }: { unstyled: boolean | undefined }) {
  return (
    <>
      {!unstyled && <style>{"@keyframes fc-spin{to{transform:rotate(360deg)}}"}</style>}
      <span className="fc-liveness__spinner" aria-hidden="true" style={unstyled ? undefined : spinnerStyle} />
    </>
  );
}

const spinnerStyle: CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "50%",
  border: "3px solid rgba(255, 255, 255, 0.35)",
  borderTopColor: "#fff",
  animation: "fc-spin 0.8s linear infinite",
};
