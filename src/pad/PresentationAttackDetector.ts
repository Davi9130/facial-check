import type { PadInput, PadProvider } from "./PadProvider";
import type { PadAnalysis, PadInconclusiveReason, PadResult } from "./PadResult";
import { aggregatePadStatus, inconclusivePadResult, isPadStatus } from "./PadResult";

/** Configuration of a {@link PresentationAttackDetector}. */
export interface PresentationAttackDetectorConfig {
  /** Providers queried on every analysis (in parallel). Names must be unique. */
  readonly providers?: readonly PadProvider[];
  /**
   * Per-analysis timeout in milliseconds. Providers that have not answered in
   * time are recorded as `INCONCLUSIVE` (`TIMEOUT`). Default: 10000.
   */
  readonly timeoutMs?: number;
  /** How many analyses to keep in the in-memory history. Default: 20. */
  readonly maxHistory?: number;
  /** Clock, injectable for tests. Default: `Date.now`. */
  readonly now?: () => number;
}

/** Per-call options of {@link PresentationAttackDetector.analyze}. */
export interface PadDetectOptions {
  /** Cancels the analysis; pending providers become `INCONCLUSIVE` (`ABORTED`). */
  readonly signal?: AbortSignal;
  /** Overrides the configured timeout for this call. */
  readonly timeoutMs?: number;
}

export type PadAnalysisListener = (analysis: PadAnalysis) => void;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_HISTORY = 20;

/**
 * Orchestrates one or more {@link PadProvider}s and records their results.
 *
 * - Fully independent from the challenge engine and from face engines: it only
 *   consumes frames/evidence and produces a {@link PadAnalysis}.
 * - Fail-safe: provider errors, timeouts, cancellations and invalid answers
 *   become `INCONCLUSIVE`, never `NO_ATTACK_DETECTED`.
 * - Results are combined with the conservative `strict` policy (see
 *   {@link aggregatePadStatus}).
 * - Only results are recorded (in memory); frames and evidence are never
 *   stored or logged.
 *
 * `NO_ATTACK_DETECTED` means the providers found no attack in the evidence
 * they received. It is NOT an absolute proof of authenticity.
 */
export class PresentationAttackDetector {
  readonly #providers = new Map<string, PadProvider>();
  readonly #listeners = new Set<PadAnalysisListener>();
  readonly #history: PadAnalysis[] = [];
  readonly #timeoutMs: number;
  readonly #maxHistory: number;
  readonly #now: () => number;
  #sequence = 0;

  constructor(config: PresentationAttackDetectorConfig = {}) {
    this.#timeoutMs = positiveOr(config.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.#maxHistory = Math.floor(nonNegativeOr(config.maxHistory, DEFAULT_MAX_HISTORY, "maxHistory"));
    this.#now = config.now ?? Date.now;
    for (const provider of config.providers ?? []) this.register(provider);
  }

  /** Adds a provider. Throws if a provider with the same name is registered. */
  register(provider: PadProvider): this {
    if (!provider.name) throw new TypeError("PadProvider.name must be a non-empty string.");
    if (this.#providers.has(provider.name)) {
      throw new Error(`A PAD provider named "${provider.name}" is already registered.`);
    }
    this.#providers.set(provider.name, provider);
    return this;
  }

  /** Removes a provider by name. Returns whether it was registered. */
  unregister(name: string): boolean {
    return this.#providers.delete(name);
  }

  /** Names of the registered providers, in registration order. */
  get providers(): readonly string[] {
    return [...this.#providers.keys()];
  }

  /**
   * Runs every registered provider on `input` and returns the consolidated
   * analysis. Never rejects because of a provider; with no provider the
   * result is `INCONCLUSIVE` (`NO_PROVIDERS`).
   */
  async analyze(input: PadInput, options: PadDetectOptions = {}): Promise<PadAnalysis> {
    const startedAt = this.#now();
    const id = `pad-${startedAt.toString(36)}-${(++this.#sequence).toString(36)}`;
    const providers = [...this.#providers.values()];

    let results: PadResult[];
    if (providers.length === 0) {
      results = [inconclusivePadResult("none", "NO_PROVIDERS", startedAt, "No PAD provider registered.")];
    } else {
      const timeoutMs = positiveOr(options.timeoutMs, this.#timeoutMs, "timeoutMs");
      results = await this.#runProviders(providers, input, timeoutMs, options.signal);
    }

    const analysis: PadAnalysis = Object.freeze({
      id,
      status: providers.length === 0 ? "INCONCLUSIVE" : aggregatePadStatus(results),
      results: Object.freeze(results.map((r) => Object.freeze(r))),
      aggregation: "strict",
      startedAt,
      completedAt: this.#now(),
    });
    this.#record(analysis);
    return analysis;
  }

  /** Most recent analysis, if any. */
  getLastAnalysis(): PadAnalysis | undefined {
    return this.#history.at(-1);
  }

  /** Recorded analyses, oldest first (bounded by `maxHistory`). */
  getHistory(): readonly PadAnalysis[] {
    return [...this.#history];
  }

  clearHistory(): void {
    this.#history.length = 0;
  }

  /** Subscribes to completed analyses. Returns an unsubscribe function. */
  onAnalysis(listener: PadAnalysisListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Disposes every provider and clears listeners, history and providers. */
  async dispose(): Promise<void> {
    const providers = [...this.#providers.values()];
    this.#providers.clear();
    this.#listeners.clear();
    this.clearHistory();
    await Promise.allSettled(providers.map(async (p) => p.dispose?.()));
  }

  async #runProviders(
    providers: readonly PadProvider[],
    input: PadInput,
    timeoutMs: number,
    external: AbortSignal | undefined,
  ): Promise<PadResult[]> {
    const controller = new AbortController();
    let stopReason: PadInconclusiveReason | undefined;
    let wake: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => (wake = resolve));
    const stop = (reason: PadInconclusiveReason): void => {
      if (stopReason) return;
      stopReason = reason;
      controller.abort();
      wake();
    };

    const onExternalAbort = (): void => stop("ABORTED");
    if (external?.aborted) stop("ABORTED");
    else external?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);

    try {
      return await Promise.all(
        providers.map(async (provider) => {
          if (stopReason) return inconclusivePadResult(provider.name, stopReason, this.#now());
          const call = this.#callProvider(provider, input, controller.signal);
          const outcome = await Promise.race([call, stopped.then(() => undefined)]);
          return outcome ?? inconclusivePadResult(provider.name, stopReason ?? "ABORTED", this.#now());
        }),
      );
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    }
  }

  async #callProvider(provider: PadProvider, input: PadInput, signal: AbortSignal): Promise<PadResult> {
    try {
      const raw: unknown = await provider.analyze(input, { signal });
      return this.#normalize(provider.name, raw);
    } catch {
      // The error is intentionally not propagated nor logged: it may carry
      // provider payloads. The result records only that the provider failed.
      return inconclusivePadResult(provider.name, "PROVIDER_ERROR", this.#now(), "PAD provider failed.");
    }
  }

  /**
   * Keeps only the documented fields of a provider answer (so no extra,
   * possibly biometric, data is recorded) and rejects invalid answers.
   */
  #normalize(providerName: string, raw: unknown): PadResult {
    if (typeof raw !== "object" || raw === null || !isPadStatus((raw as { status?: unknown }).status)) {
      return inconclusivePadResult(providerName, "INVALID_RESULT", this.#now(), "Invalid PAD result.");
    }
    const r = raw as Partial<Record<keyof PadResult, unknown>> & { status: PadResult["status"] };
    const timestamp = typeof r.timestamp === "number" && Number.isFinite(r.timestamp) ? r.timestamp : this.#now();
    let result: PadResult = { status: r.status, provider: providerName, timestamp };
    if (typeof r.score === "number" && Number.isFinite(r.score) && r.score >= 0 && r.score <= 1) {
      result = { ...result, score: r.score };
    }
    if (typeof r.reason === "string") result = { ...result, reason: r.reason };
    if (typeof r.message === "string") result = { ...result, message: r.message };
    return result;
  }

  #record(analysis: PadAnalysis): void {
    if (this.#maxHistory > 0) {
      this.#history.push(analysis);
      if (this.#history.length > this.#maxHistory) this.#history.splice(0, this.#history.length - this.#maxHistory);
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(analysis);
      } catch {
        // A faulty listener must not break the analysis nor other listeners.
      }
    }
  }
}

function positiveOr(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive number.`);
  return value;
}

function nonNegativeOr(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative number.`);
  return value;
}
