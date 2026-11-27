/**
 * Standardized results for Presentation Attack Detection (PAD).
 *
 * IMPORTANT: a PAD result is a risk signal, not an authentication. In
 * particular, `NO_ATTACK_DETECTED` only means that the configured provider(s)
 * did not find evidence of a presentation attack (photo, screen replay, mask,
 * ...) in the evidence they received. It is NOT proof that the face is real,
 * live, or belongs to the claimed person. Combine it with other controls.
 */

/** Outcome of a PAD analysis. */
export type PadStatus =
  /**
   * The provider did not detect a presentation attack in the analyzed
   * evidence. This is NOT an absolute proof of authenticity or liveness.
   */
  | "NO_ATTACK_DETECTED"
  /** The provider detected evidence of a presentation attack. */
  | "PRESENTATION_ATTACK"
  /**
   * No decision could be made: provider error, timeout, cancellation,
   * insufficient evidence, invalid response, or no provider configured.
   * Consumers must never treat this as `NO_ATTACK_DETECTED`.
   */
  | "INCONCLUSIVE";

/** All valid {@link PadStatus} values. */
export const PAD_STATUSES: readonly PadStatus[] = ["NO_ATTACK_DETECTED", "PRESENTATION_ATTACK", "INCONCLUSIVE"];

/** Machine-readable reason attached to `INCONCLUSIVE` results produced by the SDK. */
export type PadInconclusiveReason =
  | "NO_PROVIDERS"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "INVALID_RESULT"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_IMPLEMENTED";

/** Result produced by a single {@link PadProvider}. */
export interface PadResult {
  /** Decision of the provider. See {@link PadStatus} for its limits. */
  readonly status: PadStatus;
  /**
   * Optional attack-likelihood score in `[0, 1]` (higher = more likely an
   * attack). Its calibration is provider-specific; do not compare scores
   * across providers.
   */
  readonly score?: number;
  /** Name of the provider that produced the result. */
  readonly provider: string;
  /** Epoch milliseconds when the result was produced. */
  readonly timestamp: number;
  /** Machine-readable reason, set on `INCONCLUSIVE` results. */
  readonly reason?: PadInconclusiveReason | (string & {});
  /**
   * Short human-readable message. Must never contain biometric data
   * (images, landmarks, embeddings).
   */
  readonly message?: string;
}

/** How the detector combined the results of several providers. */
export type PadAggregation =
  /**
   * Default and most conservative policy: any `PRESENTATION_ATTACK` wins;
   * otherwise any `INCONCLUSIVE` makes the decision inconclusive; only when
   * every provider reports `NO_ATTACK_DETECTED` is that the decision.
   */
  "strict";

/** Consolidated result of a {@link PresentationAttackDetector} analysis. */
export interface PadAnalysis {
  /** Unique id of this analysis (useful to correlate with a session). */
  readonly id: string;
  /** Consolidated decision. `NO_ATTACK_DETECTED` is NOT proof of authenticity. */
  readonly status: PadStatus;
  /** Per-provider results, in provider registration order. */
  readonly results: readonly PadResult[];
  /** Policy used to consolidate `results`. */
  readonly aggregation: PadAggregation;
  /** Epoch milliseconds when the analysis started. */
  readonly startedAt: number;
  /** Epoch milliseconds when the analysis finished. */
  readonly completedAt: number;
}

/** Builds an `INCONCLUSIVE` result. */
export function inconclusivePadResult(
  provider: string,
  reason: PadInconclusiveReason | (string & {}),
  timestamp: number = Date.now(),
  message?: string,
): PadResult {
  return message === undefined
    ? { status: "INCONCLUSIVE", provider, timestamp, reason }
    : { status: "INCONCLUSIVE", provider, timestamp, reason, message };
}

/** Type guard for {@link PadStatus}. */
export function isPadStatus(value: unknown): value is PadStatus {
  return typeof value === "string" && (PAD_STATUSES as readonly string[]).includes(value);
}

/**
 * Consolidates provider results with the `strict` policy: attack > inconclusive >
 * no attack. An empty list is `INCONCLUSIVE`.
 */
export function aggregatePadStatus(results: readonly Pick<PadResult, "status">[]): PadStatus {
  if (results.length === 0) return "INCONCLUSIVE";
  if (results.some((r) => r.status === "PRESENTATION_ATTACK")) return "PRESENTATION_ATTACK";
  if (results.every((r) => r.status === "NO_ATTACK_DETECTED")) return "NO_ATTACK_DETECTED";
  return "INCONCLUSIVE";
}
