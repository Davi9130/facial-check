import { HeadPoseAnalyzer } from "../analysis/HeadPoseAnalyzer";
import type { HeadPoseAnalysis } from "../types/analysis.types";
import type {
  DetectorInput,
  DetectorPhase,
  HeadMovement,
  HeadMovementEvent,
  HeadPoseDetectorOptions,
  HeadPoseDetectorResult,
  HeadPoseThresholds,
  SmoothedHeadPose,
} from "../types/detector.types";
import { frameTimestamp, isFaceAnalysis, resolveTemporalOptions, toMovementEvent, type ResolvedTemporalOptions } from "./MovementDetector";
import { ExponentialMovingAverage } from "./smoothing";
import { TemporalTrigger } from "./TemporalTrigger";

type Axis = "yaw" | "pitch" | "roll";

/** Axis and sign of each movement, following the `HeadPose` conventions (subject's own sides). */
const MOVEMENTS: Readonly<Record<HeadMovement, { readonly axis: Axis; readonly sign: 1 | -1 }>> = {
  "turn-right": { axis: "yaw", sign: 1 },
  "turn-left": { axis: "yaw", sign: -1 },
  "look-up": { axis: "pitch", sign: 1 },
  "look-down": { axis: "pitch", sign: -1 },
  "tilt-right": { axis: "roll", sign: 1 },
  "tilt-left": { axis: "roll", sign: -1 },
};

export const HEAD_MOVEMENTS: readonly HeadMovement[] = Object.keys(MOVEMENTS) as HeadMovement[];

const DEFAULT_THRESHOLDS: Readonly<Record<Axis, Required<HeadPoseThresholds>>> = {
  yaw: { enter: 20, exit: 10 },
  pitch: { enter: 15, exit: 8 },
  roll: { enter: 15, exit: 8 },
};

/**
 * Detects head movements (turn left/right, look up/down, tilt left/right) from
 * the smoothed head pose.
 *
 * Each movement must start from rest on its axis (|angle| below `exit` for
 * `minRestFrames`), go past `enter` and stay there for `minActiveFrames`.
 * The head must come back to rest before the same movement counts again.
 * Directions are the subject's own (`turn-left` = the subject turns to their left).
 */
export class HeadPoseDetector {
  private readonly temporal: ResolvedTemporalOptions;
  private readonly movements: readonly HeadMovement[];
  private readonly smoothers: Record<Axis, ExponentialMovingAverage>;
  private readonly triggers = new Map<HeadMovement, TemporalTrigger>();
  private readonly headPoseAnalyzer: HeadPoseAnalyzer;
  private eventCounts: Partial<Record<HeadMovement, number>> = {};
  private lastTimestamp: number | null = null;

  constructor(options: HeadPoseDetectorOptions = {}) {
    this.temporal = resolveTemporalOptions(options, {
      smoothing: 0.5,
      minActiveFrames: 4,
      minRestFrames: 3,
      minConfidence: 0.3,
      maxFrameGapMs: 500,
    });
    this.movements = [...new Set(options.movements ?? HEAD_MOVEMENTS)];
    for (const m of this.movements) {
      if (!(m in MOVEMENTS)) throw new RangeError(`HeadPoseDetector: unknown movement "${String(m)}".`);
    }
    const thresholds: Record<Axis, Required<HeadPoseThresholds>> = {
      yaw: { ...DEFAULT_THRESHOLDS.yaw, ...options.yaw },
      pitch: { ...DEFAULT_THRESHOLDS.pitch, ...options.pitch },
      roll: { ...DEFAULT_THRESHOLDS.roll, ...options.roll },
    };
    for (const m of this.movements) {
      const th = thresholds[MOVEMENTS[m].axis];
      if (!(th.enter > 0 && th.exit >= 0 && th.exit <= th.enter)) {
        throw new RangeError(`HeadPoseDetector: invalid thresholds for ${MOVEMENTS[m].axis}.`);
      }
      this.triggers.set(
        m,
        new TemporalTrigger({
          mode: "hold",
          enter: th.enter,
          exit: th.exit,
          minActiveFrames: this.temporal.minActiveFrames,
          minRestFrames: this.temporal.minRestFrames,
          minConfidence: this.temporal.minConfidence,
          maxActiveMs: Infinity,
        }),
      );
    }
    const alpha = this.temporal.smoothing;
    this.smoothers = {
      yaw: new ExponentialMovingAverage(alpha),
      pitch: new ExponentialMovingAverage(alpha),
      roll: new ExponentialMovingAverage(alpha),
    };
    this.headPoseAnalyzer = new HeadPoseAnalyzer(options.headPose);
  }

  /** Events confirmed per movement since creation or the last `reset()`. */
  get counts(): Readonly<Partial<Record<HeadMovement, number>>> {
    return { ...this.eventCounts };
  }

  /** Feeds one frame. Call once per frame, in order. */
  update(input: DetectorInput, timestamp?: number): HeadPoseDetectorResult {
    const ts = frameTimestamp(input, timestamp);
    const gap = this.lastTimestamp === null ? 0 : ts - this.lastTimestamp;
    this.lastTimestamp = ts;
    if (gap > this.temporal.maxFrameGapMs || gap < 0) this.disarm();

    const analysis: HeadPoseAnalysis | null = input
      ? isFaceAnalysis(input)
        ? input.headPose
        : this.headPoseAnalyzer.analyze(input)
      : null;
    if (!analysis || ![analysis.yaw, analysis.pitch, analysis.roll].every(Number.isFinite)) {
      this.disarm();
      return this.result(ts, null, null, {}, null, 0, []);
    }

    const raw: SmoothedHeadPose = { yaw: analysis.yaw, pitch: analysis.pitch, roll: analysis.roll };
    const pose: SmoothedHeadPose = {
      yaw: this.smoothers.yaw.push(raw.yaw),
      pitch: this.smoothers.pitch.push(raw.pitch),
      roll: this.smoothers.roll.push(raw.roll),
    };

    const phases: Partial<Record<HeadMovement, DetectorPhase>> = {};
    const events: HeadMovementEvent[] = [];
    let activeMovement: HeadMovement | null = null;
    let progress = 0;
    for (const m of this.movements) {
      const { axis, sign } = MOVEMENTS[m];
      const trigger = this.triggers.get(m);
      if (!trigger) continue;
      const angle = pose[axis];
      const step = trigger.update(sign * angle, ts, Math.abs(angle));
      phases[m] = step.phase;
      if (step.fired) {
        events.push({ ...toMovementEvent(step.fired, sign), type: "head-movement", direction: m });
        this.eventCounts[m] = (this.eventCounts[m] ?? 0) + 1;
      }
      if ((step.phase === "active" || step.fired) && step.progress >= progress) {
        progress = step.progress;
        activeMovement = step.phase === "active" ? m : activeMovement;
      }
    }

    return this.result(ts, raw, pose, phases, activeMovement, progress, events);
  }

  /** Clears all state, including the event counts. */
  reset(): void {
    this.disarm();
    this.lastTimestamp = null;
    this.eventCounts = {};
  }

  private disarm(): void {
    for (const s of Object.values(this.smoothers)) s.reset();
    for (const t of this.triggers.values()) t.disarm();
  }

  private result(
    timestamp: number,
    raw: SmoothedHeadPose | null,
    pose: SmoothedHeadPose | null,
    phases: Partial<Record<HeadMovement, DetectorPhase>>,
    activeMovement: HeadMovement | null,
    progress: number,
    events: HeadMovementEvent[],
  ): HeadPoseDetectorResult {
    if (!pose) for (const m of this.movements) phases[m] = "idle";
    let count = 0;
    for (const n of Object.values(this.eventCounts)) count += n ?? 0;
    return {
      timestamp,
      hasData: pose !== null,
      raw,
      pose,
      phases,
      activeMovement,
      progress,
      event: events[0] ?? null,
      events,
      count,
      counts: this.counts,
    };
  }
}
