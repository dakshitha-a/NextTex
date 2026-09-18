import { describe, expect, it } from "vitest";

import { openedWords, rowAfterKey, rowMarks, shortPath } from "./project-row";

describe("the path on a project row", () => {
  it("folds the home directory to a tilde", () => {
    expect(shortPath("/home/d/writing/thesis", "/home/d")).toBe("~/writing/thesis");
    expect(shortPath("/home/d/writing/thesis", "/home/d/")).toBe("~/writing/thesis");
  });

  it("leaves a path outside home alone, and does not match a prefix of a name", () => {
    expect(shortPath("/srv/papers/thesis", "/home/d")).toBe("/srv/papers/thesis");
    expect(shortPath("/home/dakshitha/thesis", "/home/d")).toBe("/home/dakshitha/thesis");
  });

  it("is a tilde for home itself, and copes with nothing known", () => {
    expect(shortPath("/home/d", "/home/d")).toBe("~");
    expect(shortPath("/home/d/thesis", "")).toBe("/home/d/thesis");
  });
});

describe("when a row was opened", () => {
  const now = 1_800_000_000_000;

  it("has words for never", () => {
    expect(openedWords(0, now)).toBe("not opened yet");
  });

  it("otherwise says how long ago", () => {
    expect(openedWords(now / 1000 - 3 * 3600, now)).toBe("3 h ago");
  });
});

describe("the marks after a name", () => {
  it("says nothing about an ordinary project", () => {
    expect(rowMarks({ shared: false, removed: false })).toEqual([]);
  });

  it("marks a shared one, and says when this install was removed from it", () => {
    expect(rowMarks({ shared: true, removed: false })).toEqual(["shared"]);
    expect(rowMarks({ shared: true, removed: true })).toEqual(["removed from the share"]);
  });
});

describe("the arrow keys on the list", () => {
  const order = ["a", "b", "c"];

  it("walk down and up and stop at the ends", () => {
    expect(rowAfterKey(order, "a", "ArrowDown")).toBe("b");
    expect(rowAfterKey(order, "c", "ArrowDown")).toBeNull();
    expect(rowAfterKey(order, "b", "ArrowUp")).toBe("a");
    expect(rowAfterKey(order, "a", "ArrowUp")).toBeNull();
  });

  it("go to the ends on Home and End", () => {
    expect(rowAfterKey(order, "b", "Home")).toBe("a");
    expect(rowAfterKey(order, "b", "End")).toBe("c");
  });

  it("do nothing for another key, an empty list, or a row that is gone", () => {
    expect(rowAfterKey(order, "b", "Enter")).toBeNull();
    expect(rowAfterKey([], "b", "ArrowDown")).toBeNull();
    // A focused row the filter has hidden: down lands on the first row.
    expect(rowAfterKey(order, "zz", "ArrowDown")).toBe("a");
  });
});
