import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../../src/core/EventEmitter";

interface Events {
  a: number;
  b: string;
}

describe("EventEmitter", () => {
  it("calls listeners of the emitted event only", () => {
    const e = new EventEmitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    e.on("a", a);
    e.on("b", b);
    e.emit("a", 1);
    expect(a).toHaveBeenCalledWith(1);
    expect(b).not.toHaveBeenCalled();
    expect(e.listenerCount("a")).toBe(1);
  });

  it("supports off, once and removeAllListeners", () => {
    const e = new EventEmitter<Events>();
    const fn = vi.fn();
    const off = e.on("a", fn);
    off();
    const once = vi.fn();
    e.once("a", once);
    e.emit("a", 1);
    e.emit("a", 2);
    expect(fn).not.toHaveBeenCalled();
    expect(once).toHaveBeenCalledTimes(1);
    e.on("b", fn);
    e.removeAllListeners();
    e.emit("b", "x");
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps calling listeners when one throws", () => {
    const errors: unknown[] = [];
    const e = new EventEmitter<Events>((err) => errors.push(err));
    const after = vi.fn();
    e.on("a", () => {
      throw new Error("boom");
    });
    e.on("a", after);
    e.emit("a", 1);
    expect(after).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });
});
