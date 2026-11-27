import type { CSSProperties } from "react";
import type { FaceAnalysisIssue } from "../types/analysis.types";
import type { ChallengeType } from "../types/challenge.types";
import type { FacialCheckStatus } from "../types/session.types";
import { cssVar, cx, sx } from "./styles";
import { resolveTexts, type LivenessTexts, type LivenessTextsInput } from "./texts";

/** Short feedback shown after an attempt: movement confirmed or attempt failed. */
export type ChallengeFeedback = "done" | "retry" | null;

/** Tone of the instruction, exposed as `data-tone` for styling. */
export type InstructionTone = "info" | "action" | "warning" | "success";

export interface InstructionInput {
  status: FacialCheckStatus;
  challenge?: ChallengeType | null | undefined;
  /** Live face issues (`"too-far"`, `"not-centered"`, …). */
  faceIssues?: readonly FaceAnalysisIssue[] | undefined;
  feedback?: ChallengeFeedback | undefined;
}

export interface Instruction {
  text: string;
  tone: InstructionTone;
}

// Issues that matter while a challenge runs: the others (e.g. `unstable`)
// are expected, since the challenges ask the user to move.
const BLOCKING_DURING_CHALLENGE: readonly FaceAnalysisIssue[] = ["no-face", "multiple-faces", "partially-visible"];

/** Picks the instruction to show for a state (pure, usable in custom UIs). */
export function getInstruction(input: InstructionInput, texts: LivenessTexts = resolveTexts()): Instruction {
  const { status, challenge = null, faceIssues = [], feedback = null } = input;
  switch (status) {
    case "initializing":
      return { text: texts.loading, tone: "info" };
    case "starting":
      return { text: texts.openingCamera, tone: "info" };
    case "waiting-face": {
      const issue = faceIssues[0];
      return { text: issue ? texts.issues[issue] : texts.waitingFace, tone: issue && issue !== "no-face" ? "warning" : "info" };
    }
    case "running": {
      if (feedback === "done") return { text: texts.challengeDone, tone: "success" };
      if (feedback === "retry") return { text: texts.challengeRetry, tone: "warning" };
      const issue = faceIssues.find((i) => BLOCKING_DURING_CHALLENGE.includes(i));
      if (issue) return { text: texts.issues[issue], tone: "warning" };
      return challenge ? { text: texts.challenges[challenge], tone: "action" } : { text: texts.waitingFace, tone: "info" };
    }
    case "analyzing-pad":
      return { text: texts.analyzing, tone: "info" };
    case "completed":
      return { text: texts.success, tone: "success" };
    case "failed":
      return { text: texts.failure, tone: "warning" };
    case "stopped":
      return { text: texts.stopped, tone: "info" };
    case "error":
      return { text: texts.genericError, tone: "warning" };
    default:
      return { text: texts.description, tone: "info" };
  }
}

export interface ChallengeInstructionsProps extends InstructionInput {
  texts?: LivenessTextsInput | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  unstyled?: boolean | undefined;
}

const TONE_COLORS: Record<InstructionTone, string> = {
  info: cssVar.text,
  action: cssVar.primary,
  warning: cssVar.warning,
  success: cssVar.success,
};

/** Dynamic instruction for the current state, announced to screen readers. */
export function ChallengeInstructions({ texts, className, style, unstyled, ...input }: ChallengeInstructionsProps) {
  const instruction = getInstruction(input, resolveTexts(texts));
  const base: CSSProperties = {
    margin: 0,
    minHeight: "1.5em",
    textAlign: "center",
    fontSize: "1.125rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: TONE_COLORS[instruction.tone],
  };
  return (
    <p
      className={cx("fc-instructions", className)}
      style={sx(base, style, unstyled)}
      role="status"
      aria-live="polite"
      data-tone={instruction.tone}
      data-challenge={input.challenge ?? undefined}
    >
      {instruction.text}
    </p>
  );
}
