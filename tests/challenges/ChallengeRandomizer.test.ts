import { describe, expect, it } from "vitest";
import { CHALLENGE_TYPES, ChallengeRandomizer } from "../../src/challenges";
import { seeded } from "./frames";

describe("ChallengeRandomizer", () => {
  it("returns `count` distinct challenges from the pool", () => {
    const r = new ChallengeRandomizer({ random: seeded(1) });
    const picked = r.pick(CHALLENGE_TYPES, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    for (const t of picked) expect(CHALLENGE_TYPES).toContain(t);
  });

  it("is deterministic with an injected RNG", () => {
    const a = new ChallengeRandomizer({ random: seeded(42) }).pick(CHALLENGE_TYPES);
    const b = new ChallengeRandomizer({ random: seeded(42) }).pick(CHALLENGE_TYPES);
    expect(a).toEqual(b);
  });

  it("varies between sessions", () => {
    const r = new ChallengeRandomizer({ random: seeded(7) });
    const sequences = new Set(Array.from({ length: 20 }, () => r.pick(CHALLENGE_TYPES, 4).join(",")));
    expect(sequences.size).toBeGreaterThan(10);
  });

  it("never repeats the previous sequence, even with a constant RNG", () => {
    const r = new ChallengeRandomizer({ random: () => 0 });
    let previous = r.pick(["blink", "smile", "turn-left"]);
    for (let i = 0; i < 5; i++) {
      const next = r.pick(["blink", "smile", "turn-left"]);
      expect(next).not.toEqual(previous);
      previous = next;
    }
    const single = new ChallengeRandomizer({ random: () => 0 });
    expect(single.pick(["blink", "smile"], 1)).not.toEqual(single.pick(["blink", "smile"], 1));
  });

  it("can allow repeats and handles a single-option pool", () => {
    const r = new ChallengeRandomizer({ random: () => 0, avoidRepeat: false });
    expect(r.pick(["blink", "smile"])).toEqual(r.pick(["blink", "smile"]));
    const one = new ChallengeRandomizer();
    expect(one.pick(["blink"])).toEqual(["blink"]);
    expect(one.pick(["blink"])).toEqual(["blink"]);
  });

  it("clamps count and removes duplicates", () => {
    const r = new ChallengeRandomizer({ random: seeded(3) });
    expect(r.pick(["blink", "blink", "smile"], 10).sort()).toEqual(["blink", "smile"]);
    expect(r.pick(["blink"], 0)).toEqual([]);
  });
});
