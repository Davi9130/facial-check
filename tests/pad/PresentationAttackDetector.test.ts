import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NoopPadProvider,
  PresentationAttackDetector,
  StaticPadProvider,
  aggregatePadStatus,
  type PadInput,
  type PadProvider,
  type PadResult,
} from "../../src/pad";

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

const input: PadInput = { frames: [] };

function provider(name: string, analyze: PadProvider["analyze"], dispose?: () => void): PadProvider {
  return dispose ? { name, analyze, dispose } : { name, analyze };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("aggregatePadStatus (strict)", () => {
  it.each([
    [[], "INCONCLUSIVE"],
    [["NO_ATTACK_DETECTED"], "NO_ATTACK_DETECTED"],
    [["NO_ATTACK_DETECTED", "NO_ATTACK_DETECTED"], "NO_ATTACK_DETECTED"],
    [["NO_ATTACK_DETECTED", "INCONCLUSIVE"], "INCONCLUSIVE"],
    [["INCONCLUSIVE", "PRESENTATION_ATTACK"], "PRESENTATION_ATTACK"],
    [["NO_ATTACK_DETECTED", "PRESENTATION_ATTACK"], "PRESENTATION_ATTACK"],
  ] as const)("%j -> %s", (statuses, expected) => {
    expect(aggregatePadStatus(statuses.map((status) => ({ status })))).toBe(expected);
  });
});

describe("PresentationAttackDetector", () => {
  it("is INCONCLUSIVE when no provider is registered", async () => {
    const analysis = await new PresentationAttackDetector().analyze(input);
    expect(analysis.status).toBe("INCONCLUSIVE");
    expect(analysis.results).toEqual([expect.objectContaining({ reason: "NO_PROVIDERS" })]);
  });

  it("returns the provider result with provider name and timestamp", async () => {
    const detector = new PresentationAttackDetector({
      providers: [new StaticPadProvider({ name: "vendor", status: "NO_ATTACK_DETECTED", score: 0.1 })],
      now: () => 1000,
    });
    const analysis = await detector.analyze(input);
    expect(analysis.status).toBe("NO_ATTACK_DETECTED");
    expect(analysis.aggregation).toBe("strict");
    expect(analysis.results[0]).toMatchObject({ provider: "vendor", status: "NO_ATTACK_DETECTED", score: 0.1 });
    expect(analysis.results[0]?.timestamp).toEqual(expect.any(Number));
    expect(analysis.startedAt).toBe(1000);
  });

  it("passes the input and an abort signal to every provider", async () => {
    const analyze = vi.fn<PadProvider["analyze"]>(async () => ({
      status: "NO_ATTACK_DETECTED",
      provider: "x",
      timestamp: 1,
    }));
    await new PresentationAttackDetector({ providers: [provider("a", analyze), provider("b", analyze)] }).analyze(
      input,
    );
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0]?.[0]).toBe(input);
    expect(analyze.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("any attack wins over the other providers", async () => {
    const detector = new PresentationAttackDetector({
      providers: [
        new StaticPadProvider({ name: "a", status: "NO_ATTACK_DETECTED" }),
        new StaticPadProvider({ name: "b", status: "PRESENTATION_ATTACK", score: 0.97 }),
      ],
    });
    const analysis = await detector.analyze(input);
    expect(analysis.status).toBe("PRESENTATION_ATTACK");
    expect(analysis.results.map((r) => r.provider)).toEqual(["a", "b"]);
  });

  it("turns a throwing provider into INCONCLUSIVE, never NO_ATTACK_DETECTED", async () => {
    const detector = new PresentationAttackDetector({
      providers: [
        new StaticPadProvider({ name: "ok", status: "NO_ATTACK_DETECTED" }),
        provider("broken", () => Promise.reject(new Error("vendor down"))),
      ],
    });
    const analysis = await detector.analyze(input);
    expect(analysis.status).toBe("INCONCLUSIVE");
    expect(analysis.results[1]).toMatchObject({ provider: "broken", status: "INCONCLUSIVE", reason: "PROVIDER_ERROR" });
    expect(JSON.stringify(analysis)).not.toContain("vendor down");
  });

  it("turns a synchronously throwing provider into INCONCLUSIVE", async () => {
    const analysis = await new PresentationAttackDetector({
      providers: [
        provider("sync", () => {
          throw new Error("boom");
        }),
      ],
    }).analyze(input);
    expect(analysis.results[0]?.reason).toBe("PROVIDER_ERROR");
  });

  it("times out slow providers as INCONCLUSIVE and aborts their signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const slow = provider("slow", (_i, options) => {
      signal = options.signal;
      return new Promise<PadResult>(() => undefined);
    });
    const detector = new PresentationAttackDetector({
      providers: [slow, new StaticPadProvider({ name: "fast", status: "NO_ATTACK_DETECTED" })],
      timeoutMs: 500,
    });
    const pending = detector.analyze(input);
    await vi.advanceTimersByTimeAsync(500);
    const analysis = await pending;
    expect(analysis.status).toBe("INCONCLUSIVE");
    expect(analysis.results[0]).toMatchObject({ provider: "slow", status: "INCONCLUSIVE", reason: "TIMEOUT" });
    expect(analysis.results[1]?.status).toBe("NO_ATTACK_DETECTED");
    expect(signal?.aborted).toBe(true);
  });

  it("a late NO_ATTACK_DETECTED after the timeout is ignored", async () => {
    vi.useFakeTimers();
    const detector = new PresentationAttackDetector({
      providers: [new StaticPadProvider({ name: "late", status: "NO_ATTACK_DETECTED", delayMs: 1000 })],
      timeoutMs: 100,
    });
    const pending = detector.analyze(input);
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe("INCONCLUSIVE");
  });

  it("supports per-call timeout override", async () => {
    vi.useFakeTimers();
    const detector = new PresentationAttackDetector({
      providers: [new StaticPadProvider({ name: "p", status: "NO_ATTACK_DETECTED", delayMs: 200 })],
      timeoutMs: 100,
    });
    const pending = detector.analyze(input, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe("NO_ATTACK_DETECTED");
  });

  it("cancellation via AbortSignal yields INCONCLUSIVE (ABORTED)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const detector = new PresentationAttackDetector({
      providers: [new StaticPadProvider({ name: "p", status: "NO_ATTACK_DETECTED", delayMs: 1000 })],
    });
    const pending = detector.analyze(input, { signal: controller.signal });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const analysis = await pending;
    expect(analysis.status).toBe("INCONCLUSIVE");
    expect(analysis.results[0]?.reason).toBe("ABORTED");
  });

  it("an already-aborted signal does not call providers", async () => {
    const analyze = vi.fn<PadProvider["analyze"]>();
    const analysis = await new PresentationAttackDetector({ providers: [provider("p", analyze)] }).analyze(input, {
      signal: AbortSignal.abort(),
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(analysis.results[0]?.reason).toBe("ABORTED");
  });

  it.each([
    ["null", null],
    ["unknown status", { status: "LIVE", provider: "p", timestamp: 1 }],
    ["missing status", { provider: "p", timestamp: 1 }],
  ])("invalid provider answer (%s) becomes INCONCLUSIVE", async (_label, raw) => {
    const analysis = await new PresentationAttackDetector({
      providers: [provider("p", () => Promise.resolve(raw as unknown as PadResult))],
    }).analyze(input);
    expect(analysis.results[0]).toMatchObject({ status: "INCONCLUSIVE", reason: "INVALID_RESULT" });
  });

  it("normalizes provider answers: forces provider name, drops invalid score and unknown fields", async () => {
    const raw = { status: "NO_ATTACK_DETECTED", provider: "spoofed", timestamp: 5, score: 7, frame: "data:image/png" };
    const analysis = await new PresentationAttackDetector({
      providers: [provider("real", () => Promise.resolve(raw as unknown as PadResult))],
    }).analyze(input);
    expect(analysis.results[0]).toEqual({ status: "NO_ATTACK_DETECTED", provider: "real", timestamp: 5 });
  });

  it("records analyses in a bounded history and notifies listeners", async () => {
    const detector = new PresentationAttackDetector({
      providers: [new StaticPadProvider({ status: "PRESENTATION_ATTACK" })],
      maxHistory: 2,
    });
    const listener = vi.fn();
    const off = detector.onAnalysis(listener);
    const a1 = await detector.analyze(input);
    const a2 = await detector.analyze(input);
    const a3 = await detector.analyze(input);
    expect(new Set([a1.id, a2.id, a3.id]).size).toBe(3);
    expect(detector.getHistory()).toEqual([a2, a3]);
    expect(detector.getLastAnalysis()).toBe(a3);
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    await detector.analyze(input);
    expect(listener).toHaveBeenCalledTimes(3);
    detector.clearHistory();
    expect(detector.getHistory()).toEqual([]);
  });

  it("a throwing listener does not break the analysis", async () => {
    const detector = new PresentationAttackDetector({ providers: [new NoopPadProvider()] });
    const other = vi.fn();
    detector.onAnalysis(() => {
      throw new Error("listener");
    });
    detector.onAnalysis(other);
    await expect(detector.analyze(input)).resolves.toMatchObject({ status: "INCONCLUSIVE" });
    expect(other).toHaveBeenCalledOnce();
  });

  it("returns frozen analyses", async () => {
    const analysis = await new PresentationAttackDetector({ providers: [new NoopPadProvider()] }).analyze(input);
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.results)).toBe(true);
    expect(Object.isFrozen(analysis.results[0])).toBe(true);
  });

  it("does not keep a reference to frames or evidence", async () => {
    const evidence = { secret: "biometric-token" };
    const detector = new PresentationAttackDetector({ providers: [new NoopPadProvider()] });
    await detector.analyze({ evidence });
    expect(JSON.stringify(detector.getHistory())).not.toContain("biometric-token");
  });

  it("registers and unregisters providers; rejects duplicate names", async () => {
    const detector = new PresentationAttackDetector();
    detector.register(new NoopPadProvider("a")).register(new StaticPadProvider({ name: "b", status: "NO_ATTACK_DETECTED" }));
    expect(detector.providers).toEqual(["a", "b"]);
    expect(() => detector.register(new NoopPadProvider("a"))).toThrow(/already registered/);
    expect(() => detector.register({ name: "", analyze: vi.fn() })).toThrow(TypeError);
    expect(detector.unregister("a")).toBe(true);
    expect(detector.unregister("a")).toBe(false);
    expect((await detector.analyze(input)).status).toBe("NO_ATTACK_DETECTED");
  });

  it("validates configuration", () => {
    expect(() => new PresentationAttackDetector({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new PresentationAttackDetector({ maxHistory: -1 })).toThrow(RangeError);
  });

  it("dispose() disposes providers and clears state", async () => {
    const dispose = vi.fn();
    const failingDispose = vi.fn(() => {
      throw new Error("x");
    });
    const detector = new PresentationAttackDetector({
      providers: [provider("a", vi.fn(), dispose), provider("b", vi.fn(), failingDispose)],
    });
    await detector.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(failingDispose).toHaveBeenCalledOnce();
    expect(detector.providers).toEqual([]);
  });
});

describe("example providers", () => {
  it("NoopPadProvider never reports NO_ATTACK_DETECTED", async () => {
    const result = await new NoopPadProvider().analyze();
    expect(result).toMatchObject({ status: "INCONCLUSIVE", reason: "NOT_IMPLEMENTED", provider: "noop" });
  });

  it("a custom provider can be plugged without changing the core", async () => {
    class FrameCountProvider implements PadProvider {
      readonly name = "frame-count";
      analyze({ frames = [] }: PadInput): Promise<PadResult> {
        const status = frames.length >= 2 ? "NO_ATTACK_DETECTED" : "INCONCLUSIVE";
        return Promise.resolve({ status, provider: this.name, timestamp: Date.now() });
      }
    }
    const detector = new PresentationAttackDetector({ providers: [new FrameCountProvider()] });
    const image = document.createElement("canvas");
    expect((await detector.analyze({ frames: [{ image, timestamp: 1 }] })).status).toBe("INCONCLUSIVE");
    expect(
      (
        await detector.analyze({
          frames: [
            { image, timestamp: 1 },
            { image, timestamp: 2 },
          ],
        })
      ).status,
    ).toBe("NO_ATTACK_DETECTED");
  });
});

describe("public exports", () => {
  it("are available from `facial-check` and `facial-check/core`", async () => {
    const root = await import("../../src/index");
    const core = await import("../../src/core/index");
    expect(root.PresentationAttackDetector).toBe(PresentationAttackDetector);
    expect(core.PresentationAttackDetector).toBe(PresentationAttackDetector);
    expect(core.NoopPadProvider).toBe(NoopPadProvider);
  });
});

describe("decoupling", () => {
  it("PAD sources only import from the pad module itself (no challenges, engines, React)", () => {
    const sources: Record<string, string> = import.meta.glob("../../src/pad/*.ts", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    for (const [file, code] of Object.entries(sources)) {
      const specifiers = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const specifier of specifiers) expect(specifier, file).toMatch(/^\.\/[A-Za-z]+$/);
    }
  });
});
