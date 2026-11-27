/**
 * Entry point: `facial-check/react`
 *
 * React components and hooks (e.g. `FaceLiveness`, `useFacialCheck`).
 * React is a peer dependency and is never bundled.
 * Symbols are added by the tasks that implement them.
 */
// TASK 11 — headless hooks
export * from "./hooks";
// TASK 10 — components
export { FaceLiveness, getErrorMessage, isPermissionDenied } from "./FaceLiveness";
export type { FaceLivenessClassNames, FaceLivenessProps, FaceLivenessRenderState, LivenessPhase } from "./FaceLiveness";
export { FaceCamera, type FaceCameraProps } from "./FaceCamera";
export { FaceGuide, type FaceGuideProps, type FaceGuideState } from "./FaceGuide";
export { ChallengeInstructions, getInstruction } from "./ChallengeInstructions";
export type { ChallengeFeedback, ChallengeInstructionsProps, Instruction, InstructionInput, InstructionTone } from "./ChallengeInstructions";
export { LivenessProgress, type LivenessProgressProps } from "./LivenessProgress";
export { DEFAULT_TEXTS, resolveTexts, type LivenessTexts, type LivenessTextsInput } from "./texts";
