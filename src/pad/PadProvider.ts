import type { PadResult, PadStatus } from "./PadResult";
import { inconclusivePadResult } from "./PadResult";

/**
 * Image sources a PAD provider may receive. Plain browser types on purpose:
 * PAD does not depend on any face engine or on the challenge engine.
 */
export type PadImageSource =
  | ImageData
  | ImageBitmap
  | HTMLCanvasElement
  | HTMLVideoElement
  | HTMLImageElement
  | OffscreenCanvas
  | Blob;

/** A captured frame handed to PAD providers. */
export interface PadFrame {
  readonly image: PadImageSource;
  /** Epoch milliseconds when the frame was captured. */
  readonly timestamp: number;
}

/**
 * Evidence for a PAD analysis: frames and/or opaque, provider-specific
 * evidence (e.g. a vendor SDK token or encrypted capture). The SDK never
 * stores, logs or uploads this data; a provider that sends it to a remote
 * service is responsible for user consent and data-protection compliance
 * (e.g. LGPD for biometric data).
 */
export interface PadInput {
  readonly frames?: readonly PadFrame[];
  readonly evidence?: unknown;
}

/** Options passed by the detector to every provider call. */
export interface PadAnalyzeOptions {
  /**
   * Aborted when the analysis times out or is cancelled. Providers should
   * stop work and release resources when it fires.
   */
  readonly signal: AbortSignal;
}

/**
 * Pluggable PAD backend (local model, vendor SDK, remote service, ...).
 *
 * Implement this interface to add a provider; the detector core does not need
 * to change. Contract:
 * - Return `NO_ATTACK_DETECTED` only when the provider actually analyzed the
 *   evidence and found no attack. When unsure, return `INCONCLUSIVE`.
 * - Throwing, rejecting, timing out or returning an invalid result is turned
 *   into `INCONCLUSIVE` by the detector — never into `NO_ATTACK_DETECTED`.
 * - Never log or persist biometric data.
 */
export interface PadProvider {
  /** Unique, stable provider name (used in results). */
  readonly name: string;
  analyze(input: PadInput, options: PadAnalyzeOptions): Promise<PadResult>;
  /** Optional cleanup hook, called by `PresentationAttackDetector.dispose()`. */
  dispose?(): void | Promise<void>;
}

/**
 * Placeholder provider for when no PAD mechanism is available. It always
 * answers `INCONCLUSIVE` (`NOT_IMPLEMENTED`): having no PAD must never look
 * like "no attack".
 */
export class NoopPadProvider implements PadProvider {
  readonly name: string;

  constructor(name = "noop") {
    this.name = name;
  }

  analyze(): Promise<PadResult> {
    return Promise.resolve(
      inconclusivePadResult(this.name, "NOT_IMPLEMENTED", Date.now(), "No PAD mechanism configured."),
    );
  }
}

/** Options for {@link StaticPadProvider}. */
export interface StaticPadProviderOptions {
  readonly name?: string;
  readonly status: PadStatus;
  readonly score?: number;
  /** Artificial latency in milliseconds (honours the abort signal). */
  readonly delayMs?: number;
}

/**
 * Example/test provider that always returns a fixed status. Useful for tests,
 * demos and as a template for real providers. Do not use in production.
 */
export class StaticPadProvider implements PadProvider {
  readonly name: string;
  readonly #options: StaticPadProviderOptions;

  constructor(options: StaticPadProviderOptions) {
    this.name = options.name ?? "static";
    this.#options = options;
  }

  async analyze(_input: PadInput, { signal }: PadAnalyzeOptions): Promise<PadResult> {
    const { delayMs = 0, status, score } = this.#options;
    if (delayMs > 0) await abortableDelay(delayMs, signal);
    if (signal.aborted) return inconclusivePadResult(this.name, "ABORTED");
    const base = { status, provider: this.name, timestamp: Date.now() };
    return score === undefined ? base : { ...base, score };
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
