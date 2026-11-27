import type { ChallengeEvidence, ChallengeStep, ChallengeType, Challenge } from "../types/challenge.types";
import type { DetectorInput, DetectorResult, HeadMovement, HeadPoseDetectorResult, MovementEvent } from "../types/detector.types";
import type { HeadPoseDetector } from "../detectors/HeadPoseDetector";

interface ScalarDetector {
  update(input: DetectorInput, timestamp?: number): DetectorResult;
  reset(): void;
}

function evidence(event: MovementEvent, direction?: string): ChallengeEvidence {
  return {
    detector: event.type,
    ...(direction === undefined ? {} : { direction }),
    confidence: event.confidence,
    durationMs: event.durationMs,
    frames: event.frames,
    timestamp: event.timestamp,
  };
}

/** Challenge completed by the first event of a single-signal detector (blink, mouth, smile). */
export abstract class ScalarDetectorChallenge implements Challenge {
  abstract readonly type: ChallengeType;

  protected constructor(private readonly detector: ScalarDetector) {}

  update(input: DetectorInput, timestamp: number): ChallengeStep {
    const r = this.detector.update(input, timestamp);
    return {
      progress: r.event ? 1 : r.progress,
      completed: r.event !== null,
      hasFace: r.hasData,
      evidence: r.event ? evidence(r.event) : null,
    };
  }

  reset(): void {
    this.detector.reset();
  }
}

/** Challenge completed by a head movement in one of `directions`. */
export abstract class HeadMovementChallenge implements Challenge {
  abstract readonly type: ChallengeType;

  protected constructor(
    private readonly detector: HeadPoseDetector,
    private readonly directions: readonly HeadMovement[],
  ) {}

  update(input: DetectorInput, timestamp: number): ChallengeStep {
    const r: HeadPoseDetectorResult = this.detector.update(input, timestamp);
    const event = r.events.find((e) => this.directions.includes(e.direction)) ?? null;
    const progress = r.activeMovement && this.directions.includes(r.activeMovement) ? r.progress : 0;
    return {
      progress: event ? 1 : progress,
      completed: event !== null,
      hasFace: r.hasData,
      evidence: event ? evidence(event, event.direction) : null,
    };
  }

  reset(): void {
    this.detector.reset();
  }
}
