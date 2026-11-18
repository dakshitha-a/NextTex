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
});

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
});
