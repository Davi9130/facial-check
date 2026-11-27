import { describe, expect, it, vi } from "vitest";
import { ChallengeManager } from "../../src/challenges";
import type { ChallengeManagerEvents, ChallengeManagerOptions, ChallengeType } from "../../src/types/challenge.types";
import { FRAME_MS, PERFORM, play, rep, seeded } from "./frames";

function setup(options: ChallengeManagerOptions = {}) {
  let id = 0;
  const manager = new ChallengeManager({
    randomChallenges: false,
    now: () => 0,
    createSessionId: () => `s${++id}`,
    ...options,
  });
  const log: { name: keyof ChallengeManagerEvents; payload: unknown }[] = [];
  for (const name of ["challengeStarted", "challengeCompleted", "challengeFailed", "progress", "finished"] as const) {
    manager.on(name, (payload) => log.push({ name, payload }));
  }
  const of = <K extends keyof ChallengeManagerEvents>(name: K) =>
    log.filter((e) => e.name === name).map((e) => e.payload as ChallengeManagerEvents[K]);
  const feed = (poses: Parameters<typeof play>[1], start: number) => play((input, ts) => manager.update(input, ts), poses, start);
  return { manager, log, of, feed };
}

function performAll(feed: (poses: Parameters<typeof play>[1], start: number) => number, types: readonly ChallengeType[], start = 0): number {
  let ts = start;
  for (const t of types) ts = feed(PERFORM[t], ts);
  return ts;
}

describe("ChallengeManager — sequence", () => {
  it("runs the challenges in order and passes when all are validated", () => {
    const types: ChallengeType[] = ["blink", "open-mouth", "turn-left", "turn-right"];
    const { manager, of, feed } = setup({ challenges: types });

    const first = manager.start({ timestamp: 0 });
    expect(first.status).toBe("running");
    expect(first.current?.type).toBe("blink");
    expect(manager.getChallenges().map((c) => c.status)).toEqual(["active", "pending", "pending", "pending"]);

    performAll(feed, types);

    expect(manager.getStatus()).toBe("passed");
    expect(of("challengeStarted").map((e) => e.challenge.type)).toEqual(types);
    expect(of("challengeCompleted").map((e) => e.challenge.type)).toEqual(types);
    expect(of("challengeFailed")).toHaveLength(0);
    const result = of("finished")[0];
    expect(result?.passed).toBe(true);
    expect(result?.challenges.every((c) => c.status === "completed" && c.attempts === 1 && c.evidence)).toBe(true);
    expect(of("progress").at(-1)?.percent).toBe(100);
  });

  it("does not advance without the detector validating the movement", () => {
    const { manager, of, feed } = setup({ challenges: ["blink", "smile"], timeoutMs: 60_000 });
    manager.start({ timestamp: 0 });
    // Neutral face and the wrong movements: the blink challenge stays active.
    feed([...rep("neutral", 30), ...PERFORM.smile, ...PERFORM["turn-left"]], 0);
    expect(manager.getCurrentChallenge()?.type).toBe("blink");
    expect(manager.getCurrentChallenge()?.status).toBe("active");
    expect(of("challengeCompleted")).toHaveLength(0);
    expect(manager.getProgress().completed).toBe(0);
  });

  it("reports overall and per-challenge progress", () => {
    const { manager, of, feed } = setup({ challenges: ["blink", "smile"] });
    manager.start({ timestamp: 0 });
    let ts = feed(PERFORM.blink, 0);
    expect(manager.getProgress()).toMatchObject({ completed: 1, total: 2, current: "smile", currentIndex: 1, percent: 50 });
    ts = feed([...rep("neutral", 5), ...rep("smile", 2)], ts);
    const p = manager.getProgress();
    expect(p.challengeProgress).toBeGreaterThan(0);
    expect(p.percent).toBeGreaterThan(50);
    expect(p.percent).toBeLessThan(100);
    expect(of("progress").every((e) => e.percent >= 0 && e.percent <= 100)).toBe(true);
    expect(ts).toBeGreaterThan(0);
  });

  it("supports a subset (`count`) and keeps each challenge's own state", () => {
    const { manager } = setup({ count: 2 });
    manager.start({ timestamp: 0 });
    const states = manager.getChallenges();
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.index)).toEqual([0, 1]);
    expect(states[0]?.status).toBe("active");
    expect(states[1]).toMatchObject({ status: "pending", attempts: 0, startedAt: null });
  });

  it("ignores frames when not running", () => {
    const { manager, log } = setup();
    expect(manager.update(null, 0).status).toBe("idle");
    expect(log).toHaveLength(0);
  });
});

describe("ChallengeManager — randomization", () => {
  it("varies the challenges between sessions when randomChallenges is on", () => {
    const { manager } = setup({ randomChallenges: true, random: seeded(11), count: 3 });
    const sequences = Array.from({ length: 10 }, () => {
      manager.start({ timestamp: 0 });
      return manager.getChallenges().map((c) => c.type).join(",");
    });
    expect(new Set(sequences).size).toBeGreaterThan(5);
    for (let i = 1; i < sequences.length; i++) expect(sequences[i]).not.toBe(sequences[i - 1]);
  });

  it("keeps the configured order when randomChallenges is off", () => {
    const { manager } = setup({ challenges: ["smile", "blink", "head-tilt"] });
    manager.start({ timestamp: 0 });
    expect(manager.getChallenges().map((c) => c.type)).toEqual(["smile", "blink", "head-tilt"]);
  });
});

describe("ChallengeManager — timeout and attempts", () => {
  it("retries a timed-out attempt and then gives up with `timeout`", () => {
    const { manager, of, feed } = setup({ challenges: ["blink", "smile"], timeoutMs: 1000, maxAttempts: 2 });
    manager.start({ timestamp: 0 });
    feed(rep("neutral", 70), 0); // ~2.3 s

    const failed = of("challengeFailed");
    expect(failed.map((e) => [e.reason, e.attempt, e.willRetry])).toEqual([
      ["timeout", 1, true],
      ["timeout", 2, false],
    ]);
    const blink = manager.getChallenges()[0];
    expect(blink).toMatchObject({ status: "timeout", attempts: 2, failureReason: "timeout" });
    expect(manager.getChallenges()[1]?.status).toBe("pending");
    expect(manager.getStatus()).toBe("failed");
    expect(of("finished")[0]?.passed).toBe(false);
  });

  it("completes on a later attempt", () => {
    const { manager, of, feed } = setup({ challenges: ["blink"], timeoutMs: 1000, maxAttempts: 3 });
    manager.start({ timestamp: 0 });
    const ts = feed(rep("neutral", 35), 0); // first attempt times out at 1000 ms
    feed(PERFORM.blink, ts);
    expect(of("challengeFailed")).toHaveLength(1);
    expect(manager.getChallenges()[0]).toMatchObject({ status: "completed", attempts: 2, failureReason: null });
    expect(manager.getStatus()).toBe("passed");
  });

  it("starts every attempt with a fresh detector (a half movement does not carry over)", () => {
    const { manager, of, feed } = setup({ challenges: ["blink"], timeoutMs: 350, maxAttempts: 2 });
    manager.start({ timestamp: 0 });
    // Eyes close right before the first timeout and reopen in the second attempt.
    let ts = feed([...rep("neutral", 9), ...rep("eyes-closed", 3)], 0);
    expect(of("challengeFailed")).toHaveLength(1);
    ts = feed(rep("neutral", 3), ts);
    expect(of("challengeCompleted")).toHaveLength(0);
    expect(ts).toBeGreaterThan(0);
  });

  it("uses per-challenge settings", () => {
    const { manager, of, feed } = setup({
      challenges: ["blink", "smile"],
      timeoutMs: 10_000,
      maxAttempts: 3,
      challengeSettings: { smile: { timeoutMs: 500, maxAttempts: 1 } },
    });
    manager.start({ timestamp: 0 });
    expect(manager.getCurrentChallenge()).toMatchObject({ timeoutMs: 10_000, maxAttempts: 3 });
    const ts = feed(PERFORM.blink, 0);
    expect(manager.getCurrentChallenge()).toMatchObject({ type: "smile", timeoutMs: 500, maxAttempts: 1 });
    feed(rep("neutral", 20), ts);
    expect(of("challengeFailed").map((e) => e.willRetry)).toEqual([false]);
    expect(manager.getStatus()).toBe("failed");
  });

  it("times out from tick() when frames stop", () => {
    const { manager, of } = setup({ challenges: ["blink"], timeoutMs: 1000, maxAttempts: 1, maxFaceLostMs: 5000 });
    manager.start({ timestamp: 0 });
    expect(manager.tick(999).status).toBe("running");
    expect(manager.tick(1000).status).toBe("failed");
    expect(of("challengeFailed")[0]?.reason).toBe("timeout");
  });

  it("fails the attempt with `face-lost` when the face is gone too long", () => {
    const { manager, of, feed } = setup({ challenges: ["blink"], maxFaceLostMs: 300, maxAttempts: 1 });
    manager.start({ timestamp: 0 });
    feed([...rep("neutral", 3), ...rep(null, 12)], 0);
    expect(of("challengeFailed")[0]).toMatchObject({ reason: "face-lost", willRetry: false });
    expect(manager.getChallenges()[0]?.status).toBe("failed");
  });

  it("tolerates a short face loss", () => {
    const { manager, of, feed } = setup({ challenges: ["blink"], maxFaceLostMs: 300 });
    manager.start({ timestamp: 0 });
    feed([...rep("neutral", 3), ...rep(null, 5), ...PERFORM.blink], 0);
    expect(of("challengeFailed")).toHaveLength(0);
    expect(manager.getStatus()).toBe("passed");
  });

  it("failCurrent() counts as a failed attempt", () => {
    const { manager, of } = setup({ challenges: ["blink"], maxAttempts: 2 });
    manager.start({ timestamp: 0 });
    manager.failCurrent(10);
    expect(of("challengeFailed")[0]).toMatchObject({ reason: "aborted", willRetry: true, attempt: 1 });
    expect(manager.getCurrentChallenge()?.attempts).toBe(2);
  });
});

describe("ChallengeManager — sessions", () => {
  it("tags every event and result with the sessionId", () => {
    const { manager, log, feed } = setup({ challenges: ["blink", "smile"] });
    manager.start({ sessionId: "abc", timestamp: 0 });
    performAll(feed, ["blink", "smile"]);
    expect(log.length).toBeGreaterThan(0);
    for (const e of log) {
      const p = e.payload as { sessionId: string; challenge?: { sessionId: string } };
      expect(p.sessionId).toBe("abc");
      if (p.challenge) expect(p.challenge.sessionId).toBe("abc");
    }
    expect(manager.getResult()).toMatchObject({ sessionId: "abc", status: "passed", startedAt: 0 });
    expect(manager.getResult().endedAt).toBeGreaterThan(0);
  });

  it("generates a new sessionId per session and resets state", () => {
    const { manager, feed } = setup({ challenges: ["blink"] });
    manager.start({ timestamp: 0 });
    const first = manager.sessionId;
    feed(PERFORM.blink, 0);
    manager.start({ timestamp: 10_000 });
    expect(manager.sessionId).not.toBe(first);
    expect(manager.getChallenges()[0]).toMatchObject({ status: "active", attempts: 1, evidence: null });
  });

  it("generates a UUID by default", () => {
    const manager = new ChallengeManager();
    manager.start();
    expect(manager.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("stop() aborts the active challenge and finishes as stopped", () => {
    const { manager, of } = setup({ challenges: ["blink", "smile"] });
    manager.start({ timestamp: 0 });
    manager.stop(50);
    expect(of("challengeFailed")[0]).toMatchObject({ reason: "aborted", willRetry: false });
    expect(manager.getChallenges().map((c) => c.status)).toEqual(["failed", "pending"]);
    expect(of("finished")[0]).toMatchObject({ status: "stopped", passed: false, endedAt: 50 });
    manager.stop(60);
    expect(of("finished")).toHaveLength(1);
  });

  it("reset() and destroy()", () => {
    const { manager, log } = setup();
    manager.start({ timestamp: 0 });
    manager.reset();
    expect(manager.getStatus()).toBe("idle");
    expect(manager.getChallenges()).toEqual([]);
    manager.destroy();
    const before = log.length;
    manager.start({ timestamp: 0 });
    expect(log.length).toBe(before);
  });

  it("once() and the returned unsubscribe work", () => {
    const { manager, feed } = setup({ challenges: ["blink", "smile"] });
    const once = vi.fn();
    const all = vi.fn();
    manager.once("challengeStarted", once);
    const off = manager.on("challengeStarted", all);
    manager.start({ timestamp: 0 });
    off();
    feed(PERFORM.blink, 0);
    expect(once).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe("ChallengeManager — configuration", () => {
  it.each([
    [{ challenges: [] }],
    [{ challenges: ["nod" as ChallengeType] }],
    [{ count: 0 }],
    [{ count: 7 }],
    [{ timeoutMs: 0 }],
    [{ maxAttempts: 0 }],
    [{ maxFaceLostMs: -1 }],
    [{ challenges: ["blink"] as ChallengeType[], challengeSettings: { blink: { maxAttempts: 1.5 } } }],
  ])("rejects %o", (options) => {
    expect(() => new ChallengeManager(options)).toThrow(RangeError);
  });

  it("accepts custom challenge factories", () => {
    const { manager, of } = setup({
      challenges: ["blink"],
      factories: {
        blink: () => ({
          type: "blink",
          reset: () => undefined,
          update: (_input, ts) => ({
            progress: 1,
            completed: true,
            hasFace: true,
            evidence: { detector: "custom", confidence: 1, durationMs: 0, frames: 1, timestamp: ts },
          }),
        }),
      },
    });
    manager.start({ timestamp: 0 });
    manager.update(null, FRAME_MS);
    expect(of("challengeCompleted")[0]?.challenge.evidence?.detector).toBe("custom");
  });
});
