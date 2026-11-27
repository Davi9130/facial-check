import type { DetectorPhase } from "../types/detector.types";

/** How a trigger confirms a movement. */
export type TriggerMode =
  /** Confirms once the signal stays past `enter` for `minActiveFrames` (open mouth, smile, head turn). */
  | "hold"
  /** Confirms after a full rest → active → rest cycle within `maxActiveMs` (blink). */
  | "cycle";

export interface TriggerConfig {
  readonly mode: TriggerMode;
  /** Signal at or above which the movement is active. */
  readonly enter: number;
  /** Signal below which the face is at rest. Must be `<= enter` (the gap is the hysteresis band). */
  readonly exit: number;
  readonly minActiveFrames: number;
  readonly minRestFrames: number;
  readonly minConfidence: number;
  /** `cycle` only: longest active stretch still accepted. */
  readonly maxActiveMs: number;
}

export interface TriggerFiring {
  readonly startedAt: number;
  readonly timestamp: number;
  readonly frames: number;
  /** Highest signal value reached while active. */
  readonly peak: number;
  readonly confidence: number;
}

export interface TriggerStep {
  readonly phase: DetectorPhase;
  readonly progress: number;
  readonly fired: TriggerFiring | null;
}

/**
 * Hysteresis state machine over a smoothed signal where higher means "more
 * active". Needs `minRestFrames` at rest before arming, so the movement must
 * be a real transition, and `minActiveFrames` past the threshold, so a single
 * frame never fires.
 */
export class TemporalTrigger {
  private phase: DetectorPhase = "idle";
  private restFrames = 0;
  private activeFrames = 0;
  private startedAt = 0;
  private peak = -Infinity;
  /** `cycle` mode: the signal came back to rest and the reopening is being confirmed. */
  private closing = false;

  constructor(readonly config: TriggerConfig) {
    if (!(config.exit <= config.enter)) {
      throw new RangeError("TemporalTrigger: the rest threshold must not be past the activation threshold.");
    }
  }

  /**
   * @param value Signal of this frame (higher = more active).
   * @param restValue Signal used to decide "at rest" (defaults to `value`).
   */
  update(value: number, timestamp: number, restValue: number = value): TriggerStep {
    const c = this.config;
    const atRest = restValue < c.exit;
    const pastEnter = value >= c.enter;

    switch (this.phase) {
      case "idle":
      case "cooldown":
        this.countRest(atRest);
        return this.step(0);

      case "ready":
        if (pastEnter) return this.startActive(value, timestamp);
        return this.step(0);

      case "active":
        return this.whileActive(value, timestamp, atRest, pastEnter);
    }
  }

  /** Back to `idle`: the face must be seen at rest again before anything fires. */
  disarm(): void {
    this.phase = "idle";
    this.restFrames = 0;
    this.resetActive();
  }

  private whileActive(value: number, timestamp: number, atRest: boolean, pastEnter: boolean): TriggerStep {
    const c = this.config;

    if (pastEnter) {
      this.closing = false;
      this.restFrames = 0;
      this.activeFrames += 1;
      this.peak = Math.max(this.peak, value);
    }

    if (c.mode === "hold") {
      if (atRest) return this.toCooldown(1);
      if (this.activeFrames >= c.minActiveFrames) {
        const confidence = this.confidence();
        if (confidence >= c.minConfidence) return this.fire(timestamp, confidence, "cooldown");
      }
      return this.step(Math.min(1, this.activeFrames / c.minActiveFrames) * 0.99);
    }

    // cycle
    if (!this.closing && timestamp - this.startedAt > c.maxActiveMs) return this.toCooldown(atRest ? 1 : 0);

    if (atRest) {
      if (this.activeFrames < c.minActiveFrames) return this.toCooldown(1);
      this.closing = true;
      this.restFrames += 1;
      if (this.restFrames >= c.minRestFrames) {
        const confidence = this.confidence();
        if (confidence >= c.minConfidence) return this.fire(timestamp, confidence, "ready");
        return this.toCooldown(this.restFrames);
      }
    } else if (!pastEnter) {
      // Inside the hysteresis band: neither closed nor confirmed open.
      this.restFrames = 0;
    }

    const activePart = Math.min(1, this.activeFrames / c.minActiveFrames) * 0.5;
    const restPart = this.closing ? (this.restFrames / c.minRestFrames) * 0.5 : 0;
    return this.step(Math.min(0.99, activePart + restPart));
  }

  private startActive(value: number, timestamp: number): TriggerStep {
    this.phase = "active";
    this.restFrames = 0;
    this.activeFrames = 0;
    this.startedAt = timestamp;
    this.peak = -Infinity;
    this.closing = false;
    return this.whileActive(value, timestamp, false, true);
  }

  private fire(timestamp: number, confidence: number, next: DetectorPhase): TriggerStep {
    const fired: TriggerFiring = {
      startedAt: this.startedAt,
      timestamp,
      frames: this.activeFrames,
      peak: this.peak,
      confidence,
    };
    this.phase = next;
    // A blink is confirmed by its reopening, so the face is already at rest.
    this.restFrames = next === "ready" ? this.config.minRestFrames : 0;
    this.resetActive();
    return { phase: this.phase, progress: 1, fired };
  }

  private toCooldown(restFrames: number): TriggerStep {
    this.phase = "cooldown";
    this.restFrames = 0;
    this.resetActive();
    for (let i = 0; i < restFrames; i++) this.countRest(true);
    return this.step(0);
  }

  private countRest(atRest: boolean): void {
    this.restFrames = atRest ? this.restFrames + 1 : 0;
    if (this.restFrames >= this.config.minRestFrames) this.phase = "ready";
  }

  private resetActive(): void {
    this.activeFrames = 0;
    this.startedAt = 0;
    this.peak = -Infinity;
    this.closing = false;
  }

  /** Half from how far past `enter` the peak went (one hysteresis band = full), half from duration. */
  private confidence(): number {
    const c = this.config;
    const band = c.enter - c.exit;
    const margin = band > 0 ? clamp01((this.peak - c.enter) / band) : 1;
    const persistence = clamp01(this.activeFrames / (2 * c.minActiveFrames));
    return 0.5 * margin + 0.5 * persistence;
  }

  private step(progress: number): TriggerStep {
    return { phase: this.phase, progress, fired: null };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
