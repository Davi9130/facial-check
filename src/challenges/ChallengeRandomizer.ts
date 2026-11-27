import type { ChallengeType } from "../types/challenge.types";

export interface ChallengeRandomizerOptions {
  /** Random source in `[0, 1)`. Default: `Math.random`. Inject a seeded one in tests. */
  random?: () => number;
  /**
   * Reshuffle when the result equals the previous sequence, so two sessions in
   * a row never get the same challenges in the same order (when more than one
   * order is possible). Default: `true`.
   */
  avoidRepeat?: boolean;
}

/** Picks and orders the challenges of each session. */
export class ChallengeRandomizer {
  private readonly random: () => number;
  private readonly avoidRepeat: boolean;
  private previous: readonly ChallengeType[] | null = null;

  constructor(options: ChallengeRandomizerOptions = {}) {
    this.random = options.random ?? Math.random;
    this.avoidRepeat = options.avoidRepeat ?? true;
  }

  /** `count` distinct challenges of `pool`, in random order (Fisher–Yates). */
  pick(pool: readonly ChallengeType[], count: number = pool.length): ChallengeType[] {
    const unique = [...new Set(pool)];
    const n = Math.max(0, Math.min(Math.floor(count), unique.length));
    let result = this.shuffle(unique).slice(0, n);
    // More than one sequence is possible unless n is 0, or n is 1 with a single option.
    if (this.avoidRepeat && this.previous && n > 0 && unique.length > 1) {
      for (let i = 0; i < 8 && sameSequence(result, this.previous); i++) {
        result = this.shuffle(unique).slice(0, n);
      }
      if (sameSequence(result, this.previous)) result = rotate(result, unique);
    }
    this.previous = result;
    return result;
  }

  /** Forgets the previous sequence. */
  reset(): void {
    this.previous = null;
  }

  private shuffle(items: readonly ChallengeType[]): ChallengeType[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const r = this.random();
      const j = Math.min(i, Math.max(0, Math.floor(r * (i + 1))));
      [a[i], a[j]] = [a[j] as ChallengeType, a[i] as ChallengeType];
    }
    return a;
  }
}

function sameSequence(a: readonly ChallengeType[], b: readonly ChallengeType[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Deterministic fallback when the random source keeps repeating: change the sequence by one step. */
function rotate(sequence: ChallengeType[], pool: readonly ChallengeType[]): ChallengeType[] {
  if (sequence.length > 1) return [...sequence.slice(1), sequence[0] as ChallengeType];
  const other = pool.find((t) => t !== sequence[0]);
  return other ? [other] : sequence;
}
