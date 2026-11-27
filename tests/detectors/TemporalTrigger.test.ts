import { describe, expect, it } from "vitest";
import { TemporalTrigger, type TriggerConfig } from "../../src/detectors/TemporalTrigger";
import { ExponentialMovingAverage } from "../../src/detectors/smoothing";

const base: TriggerConfig = { mode: "hold", enter: 1, exit: 0.5, minActiveFrames: 3, minRestFrames: 2, minConfidence: 0, maxActiveMs: Infinity };

function run(t: TemporalTrigger, values: number[]) {
  return values.map((v, i) => t.update(v, i * 33));
}

describe("TemporalTrigger", () => {
  it("needs rest frames before arming", () => {
    const steps = run(new TemporalTrigger(base), [2, 2, 2, 2, 2]);
    expect(steps.every((s) => s.fired === null)).toBe(true);
    expect(steps.at(-1)?.phase).toBe("idle");
  });

  it("hold: fires once after minActiveFrames and waits for rest", () => {
    const steps = run(new TemporalTrigger(base), [0, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 2]);
    expect(steps.map((s) => (s.fired ? 1 : 0))).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    expect(steps[4]?.fired?.frames).toBe(3);
  });

  it("keeps state inside the hysteresis band", () => {
    const steps = run(new TemporalTrigger(base), [0, 0, 2, 0.7, 2, 0.7, 2]);
    expect(steps.map((s) => s.phase)).toEqual(["idle", "ready", "active", "active", "active", "active", "cooldown"]);
  });

  it("cycle: fires on confirmed return to rest, rejects long activations", () => {
    const cycle = new TemporalTrigger({ ...base, mode: "cycle", maxActiveMs: 200 });
    const steps = run(cycle, [0, 0, 2, 2, 2, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0]);
    expect(steps.filter((s) => s.fired)).toHaveLength(1);
    expect(steps[6]?.fired).not.toBeNull();
  });

  it("rejects an exit threshold past the enter threshold", () => {
    expect(() => new TemporalTrigger({ ...base, exit: 2 })).toThrow(RangeError);
  });
});

describe("ExponentialMovingAverage", () => {
  it("smooths and resets", () => {
    const ema = new ExponentialMovingAverage(0.5);
    expect(ema.push(10)).toBe(10);
    expect(ema.push(0)).toBe(5);
    ema.reset();
    expect(ema.value).toBeNull();
    expect(new ExponentialMovingAverage(1).push(3)).toBe(3);
    expect(() => new ExponentialMovingAverage(0)).toThrow(RangeError);
  });
});
