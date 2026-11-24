/** A burst of store writes in one task is recorded, once a page.
 *
 *  React's "Maximum update depth exceeded" names only its own store
 *  listener, so the two loops logged on 29 October and 13 November 2026
 *  could not say what kept writing. The store says it now.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const recorded: { kind: string; message: string; stack: string }[] = [];
vi.mock("./errors", async (original) => ({
  ...(await original<typeof import("./errors")>()),
  record: (kind: string, message: unknown, stack = "") =>
    recorded.push({ kind, message: String(message), stack }),
}));

const { set, WRITE_BURST } = await import("./store");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The project stream, with the messages handed over by the test. */
class FakeStream {
  static last: FakeStream | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    FakeStream.last = this;
  }
  close() {}
}

describe("a burst of writes", () => {
  test("a task's ordinary writes say nothing", async () => {
    vi.useFakeTimers();
    for (let n = 0; n < WRITE_BURST; n++) set({ spellingNote: `note ${n}` });
    vi.runAllTimers();
    for (let n = 0; n < WRITE_BURST; n++) set({ spellingNote: `again ${n}` });
    vi.runAllTimers();
    expect(recorded).toEqual([]);
  });

  test("one past the line is recorded with the keys and a stack, once", () => {
    vi.useFakeTimers();
    for (let n = 0; n <= WRITE_BURST; n++) {
      set(n % 2 ? { spellingNote: `note ${n}` } : { error: null });
    }
    for (let n = 0; n < 10; n++) set({ spellingNote: "more" });
    vi.runAllTimers();
    for (let n = 0; n <= WRITE_BURST * 2; n++) set({ spellingNote: `later ${n}` });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].message).toBe(
      `store written ${WRITE_BURST + 1} times in one task: error, spellingNote`,
    );
    expect(recorded[0].stack).toContain("store write burst");
  });

  test("a backlog of server events in one task is not a burst", async () => {
    // A store of its own: the one above has already said its once a page.
    vi.resetModules();
    const store = await import("./store");
    recorded.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeStream);
    store.connect("p1");
    const stream = FakeStream.last!;
    // An agent turn's worth, each event setting `activity`, all at once,
    // as a laptop back from standby received them.
    for (let n = 0; n < WRITE_BURST * 2; n++) {
      const type = n % 2 ? "thinking_end" : "thinking";
      stream.onmessage!({ data: JSON.stringify({ type }) });
    }
    store.disconnect();
    expect(recorded).toEqual([]);
    // And a loop of writes in one task still is.
    vi.runAllTimers();
    for (let n = 0; n <= WRITE_BURST; n++) store.set({ spellingNote: `loop ${n}` });
    expect(recorded.map((item) => item.message)).toEqual([
      `store written ${WRITE_BURST + 1} times in one task: spellingNote`,
    ]);
  });
});
