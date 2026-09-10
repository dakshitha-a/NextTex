import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";

import {
  TYPING_GRACE,
  afterQuiet,
  busyTyping,
  forgetTyping,
  noteTyping,
  onFrame,
} from "./timing";

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

/** Whether somebody is mid-sentence, which decides whether the view may
 *  move under them.
 *
 *  The agent now says where it is about to write and the editor goes to
 *  look. That is welcome when the writer is reading and unwelcome when they
 *  are typing, and a focus check cannot answer it: the caret sits in the
 *  editor for the whole time somebody is reading their own paragraph.
 */
describe("whether the writer is mid-sentence", () => {
  test("nobody has typed yet, so nothing is pinned", () => {
    forgetTyping();
    expect(busyTyping()).toBe(false);
  });

  test("a keystroke pins the view for a few seconds", () => {
    forgetTyping();
    noteTyping(1_000_000);
    expect(busyTyping(1_000_000)).toBe(true);
    expect(busyTyping(1_002_000)).toBe(true);
  });

  test("and lets go once the typing stops", () => {
    // Three seconds is a pause in typing rather than a pause in thinking:
    // long enough that finishing a word is not interrupted, short enough
    // that a writer who has stopped to read gets taken to the edit.
    forgetTyping();
    noteTyping(1_000_000);
    expect(busyTyping(1_000_000 + TYPING_GRACE)).toBe(false);
    expect(busyTyping(1_010_000)).toBe(false);
  });
});
