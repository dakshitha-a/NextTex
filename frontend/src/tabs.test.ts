import { describe, expect, it } from "vitest";
import { CLOSED_CAP, afterClosing, neighbour, pushClosed, viewingClosed } from "./tabs";
import type { Tab } from "./store";

const strip = (...paths: string[]): Tab[] => paths.map((path) => ({ path }));

describe("afterClosing", () => {
  it("leaves the tab the gesture landed on and closes the rest", () => {
    const next = afterClosing(
      strip("main.tex", "chapters/02.tex", "references.bib"),
      "chapters/02.tex",
      "others",
      "chapters/02.tex",
    );
    expect(next.tabs.map((tab) => tab.path)).toEqual(["chapters/02.tex"]);
    expect(next.activePath).toBe("chapters/02.tex");
    expect(next.closed).toEqual(["main.tex", "references.bib"]);
  });

  it("brings the target to the front when it was not there already", () => {
    const next = afterClosing(
      strip("main.tex", "references.bib"),
      "main.tex",
      "others",
      "references.bib",
    );
    expect(next.activePath).toBe("references.bib");
  });

  it("does nothing at all to a strip of one", () => {
    const tabs = strip("main.tex");
    const next = afterClosing(tabs, "main.tex", "others", "main.tex");
    expect(next.closed).toEqual([]);
    // Identity, not just equality: the caller reads `closed` to decide
    // whether to touch the store, and a fresh array here would still be the
    // right answer, but an empty `closed` is the whole guard.
    expect(next.tabs).toEqual(tabs);
  });

  it("empties the strip, and nothing is in front of nothing", () => {
    const next = afterClosing(
      strip("main.tex", "references.bib"),
      "main.tex",
      "all",
      "references.bib",
    );
    expect(next.tabs).toEqual([]);
    expect(next.activePath).toBeNull();
    expect(next.closed).toEqual(["main.tex", "references.bib"]);
  });

  it("closes nothing when the target has already left the strip", () => {
    // A menu that outlived its tab: the file was renamed underneath it, or
    // another window closed it. Left alone this would close everything.
    const next = afterClosing(
      strip("main.tex", "references.bib"),
      "main.tex",
      "others",
      "gone.tex",
    );
    expect(next.closed).toEqual([]);
    expect(next.tabs.map((tab) => tab.path)).toEqual([
      "main.tex", "references.bib",
    ]);
    expect(next.activePath).toBe("main.tex");
  });

  it("still empties the strip when the target has left it", () => {
    const next = afterClosing(strip("main.tex"), "main.tex", "all", "gone.tex");
    expect(next.closed).toEqual(["main.tex"]);
    expect(next.tabs).toEqual([]);
  });

  it("has nothing to do to an empty strip", () => {
    expect(afterClosing([], null, "all", "main.tex").closed).toEqual([]);
  });
});

describe("viewingClosed", () => {
  it("is false when nothing is being viewed", () => {
    expect(viewingClosed(null, ["main.tex"])).toBe(false);
  });

  it("is false when the version on screen belongs to a surviving tab", () => {
    expect(viewingClosed({ path: "main.tex" }, ["references.bib"])).toBe(false);
  });

  it("is true when the file whose past is on screen is going", () => {
    expect(viewingClosed({ path: "main.tex" }, ["main.tex"])).toBe(true);
  });
});

describe("neighbour", () => {
  const ring = strip("a.tex", "b.tex", "c.tex");

  it("steps forward", () => {
    expect(neighbour(ring, "a.tex", 1)).toBe("b.tex");
  });

  it("steps back", () => {
    expect(neighbour(ring, "b.tex", -1)).toBe("a.tex");
  });

  it("wraps at both ends", () => {
    // A ring, not a line. Stopping at the end makes the second press of a
    // repeated key do nothing, which reads as the key having failed.
    expect(neighbour(ring, "c.tex", 1)).toBe("a.tex");
    expect(neighbour(ring, "a.tex", -1)).toBe("c.tex");
  });

  it("goes to an end when nothing is in front", () => {
    expect(neighbour(ring, null, 1)).toBe("a.tex");
    expect(neighbour(ring, null, -1)).toBe("c.tex");
  });

  it("has nowhere to go in an empty strip", () => {
    expect(neighbour([], null, 1)).toBeNull();
  });
});

describe("pushClosed", () => {
  it("remembers what was closed, newest last", () => {
    expect(pushClosed(["a.tex"], ["b.tex"])).toEqual(["a.tex", "b.tex"]);
  });

  it("takes a whole bulk close at once", () => {
    expect(pushClosed([], ["a.tex", "b.tex"])).toEqual(["a.tex", "b.tex"]);
  });

  it("remembers a path once, at its newest position", () => {
    // Reopening a file, closing it again and pressing reopen should give
    // it back, not give it back and then give it back a second time.
    expect(pushClosed(["a.tex", "b.tex"], ["a.tex"])).toEqual(["b.tex", "a.tex"]);
  });

  it("is capped, because this is a convenience and not a history", () => {
    const many = Array.from({ length: 30 }, (_, n) => `${n}.tex`);
    const stack = pushClosed([], many);
    expect(stack).toHaveLength(CLOSED_CAP);
    expect(stack[stack.length - 1]).toBe("29.tex");
  });
});
