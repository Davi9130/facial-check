import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../../src/core/EventEmitter";
import { defaultScheduler } from "../../src/core/FacialCheckConfig";
import { getImageSize, isVideoElement } from "../../src/engines/frame";

describe("EventEmitter — edge cases", () => {
  it("removeAllListeners(event) only clears that event", () => {
    const e = new EventEmitter<{ a: number; b: number }>();
    const a = vi.fn();
    const b = vi.fn();
    e.on("a", a);
    e.on("b", b);
    e.removeAllListeners("a");
    e.emit("a", 1);
    e.emit("b", 2);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(2);
    expect(e.listenerCount("a")).toBe(0);
    expect(e.listenerCount("b")).toBe(1);
  });

  it("emitting an event with no listeners is a no-op", () => {
    const e = new EventEmitter<{ a: number }>();
    expect(() => e.emit("a", 1)).not.toThrow();
  });

  it("rethrows listener errors asynchronously by default", () => {
    vi.useFakeTimers();
    try {
      const e = new EventEmitter<{ a: number }>();
      const after = vi.fn();
      e.on("a", () => {
        throw new Error("boom");
      });
      e.on("a", after);
      e.emit("a", 1);
      expect(after).toHaveBeenCalled();
      expect(() => vi.runAllTimers()).toThrow("boom");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("defaultScheduler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses requestAnimationFrame when available", () => {
    const raf = vi.fn(() => 42);
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    const s = defaultScheduler();
    const cb = vi.fn();
    expect(s.request(cb)).toBe(42);
    s.cancel(42);
    expect(raf).toHaveBeenCalled();
    expect(caf).toHaveBeenCalledWith(42);
  });

  it("falls back to setTimeout without requestAnimationFrame", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.useFakeTimers();
    try {
      const s = defaultScheduler();
      const cb = vi.fn();
      s.request(cb);
      vi.advanceTimersByTime(20);
      expect(cb).toHaveBeenCalledTimes(1);
      const cancelled = vi.fn();
      s.cancel(s.request(cancelled));
      vi.advanceTimersByTime(20);
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getImageSize", () => {
  it("returns null for a video without a current frame", () => {
    const video = document.createElement("video");
    expect(isVideoElement(video)).toBe(true);
    expect(getImageSize(video)).toBeNull();
  });

  it("reads the natural size of a loaded image, null while loading", () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: false, configurable: true });
    expect(getImageSize(img)).toBeNull();
    Object.defineProperty(img, "complete", { value: true, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: 320 });
    Object.defineProperty(img, "naturalHeight", { value: 240 });
    expect(getImageSize(img)).toEqual({ width: 320, height: 240 });
  });

  it("reads canvas size and rejects empty canvases", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 50;
    expect(getImageSize(canvas)).toEqual({ width: 100, height: 50 });
    canvas.width = 0;
    expect(getImageSize(canvas)).toBeNull();
  });
});
