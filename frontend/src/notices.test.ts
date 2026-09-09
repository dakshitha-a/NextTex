import { beforeEach, describe, expect, it } from "vitest";

import { dismissNotice, get, set } from "./store";

describe("what the writer is told when something goes wrong", () => {
  beforeEach(() => set({ error: null }));

  it("keeps both when two things fail", () => {
    // The regression. `error` is one string and thirty call sites write to
    // it, so the second failure erased the first without a word: two
    // uploads refused, one message on screen.
    set({ error: "latexmkrc was refused" });
    set({ error: "scan.tiff was too large" });

    expect(get().notices.map((n) => n.text)).toEqual([
      "latexmkrc was refused",
      "scan.tiff was too large",
    ]);
  });

  it("does not repeat one message twice in a row", () => {
    // Two identical failures are one event to somebody reading them.
    set({ error: "the server is not answering" });
    set({ error: "the server is not answering" });
    expect(get().notices).toHaveLength(1);
  });

  it("gives each one an identity, so one can go without the others", () => {
    set({ error: "first" });
    set({ error: "second" });
    const [first, second] = get().notices;
    expect(first.id).not.toBe(second.id);

    dismissNotice(first.id);
    expect(get().notices.map((n) => n.text)).toEqual(["second"]);
  });

  it("dismissing one does not put it back", () => {
    // `dismissNotice` goes through `set`, which is what queues them, so it
    // has to be able to tell a dismissal from a new failure.
    set({ error: "only one" });
    const [only] = get().notices;
    dismissNotice(only.id);
    expect(get().notices).toEqual([]);
  });

  it("clearing the error clears the stack", () => {
    set({ error: "a" });
    set({ error: "b" });
    set({ error: null });
    expect(get().notices).toEqual([]);
  });
});
