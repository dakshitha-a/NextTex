import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterQuiet, onFrame } from "./timing";

describe("running work no oftener than it can be seen", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => {};
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const paint = () => {
    const due = frames;
    frames = [];
    for (const frame of due) frame(0);
  };

  it("collapses a burst into one call", () => {
    const seen: number[] = [];
    const run = onFrame((n: number) => seen.push(n));
    run(1);
    run(2);
    run(3);
    expect(seen).toEqual([]);      // nothing until the frame
    paint();
    expect(seen).toEqual([3]);
  });

  it("keeps the last arguments, not the first", () => {
    // These are positions and sizes: the newest is the true one, and an
    // earlier one is a place the pointer has already left.
    const seen: string[] = [];
    const run = onFrame((where: string) => seen.push(where));
    run("start");
    run("middle");
    run("end");
    paint();
    expect(seen).toEqual(["end"]);
  });

  it("runs again on the next frame", () => {
    const seen: number[] = [];
    const run = onFrame((n: number) => seen.push(n));
    run(1);
    paint();
    run(2);
    paint();
    expect(seen).toEqual([1, 2]);
  });

  it("can be cancelled before the frame arrives", () => {
    const seen: number[] = [];
    const run = onFrame((n: number) => seen.push(n));
    run(1);
    run.cancel();
    paint();
    expect(seen).toEqual([]);
  });
});

describe("running work once somebody has stopped", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the quiet", () => {
    const seen: string[] = [];
    const run = afterQuiet((what: string) => seen.push(what), 100);
    run("a");
    vi.advanceTimersByTime(50);
    run("b");
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([]);       // the second call restarted the wait
    vi.advanceTimersByTime(60);
    expect(seen).toEqual(["b"]);
  });

  it("can be cancelled", () => {
    const seen: string[] = [];
    const run = afterQuiet((what: string) => seen.push(what), 100);
    run("a");
    run.cancel();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([]);
  });
});
