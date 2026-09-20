import { describe, expect, it } from "vitest";

import { openedWords, rowAfterKey, rowMarks, shortPath, stateWords } from "./project-row";

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
    // The count is the others, said the way a sentence says it.
    expect(rowMarks({ shared: true, removed: false, people: 0 })).toEqual(["shared"]);
    expect(rowMarks({ shared: true, removed: false, people: 1 })).toEqual(["shared with one person"]);
    expect(rowMarks({ shared: true, removed: false, people: 2 })).toEqual(["shared with two people"]);
    expect(rowMarks({ shared: true, removed: false, people: 12 })).toEqual(["shared with 12 people"]);
    // Removed wins: the count is of a share this install is not in.
    expect(rowMarks({ shared: true, removed: true, people: 3 })).toEqual(["removed from the share"]);
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

describe("the marks after a name", () => {
  it("say nothing for an ordinary project", () => {
    expect(rowMarks({ shared: false, removed: false })).toEqual([]);
  });

  it("put open-elsewhere first, ahead of the share", () => {
    expect(rowMarks({ shared: true, removed: false, open: true })).toEqual([
      "open in another window",
      "shared",
    ]);
    expect(rowMarks({ shared: false, removed: false, open: true })).toEqual([
      "open in another window",
    ]);
  });
});

describe("what a row says about its state", () => {
  // A Wednesday in September at noon, local time.
  const now = new Date(2026, 8, 16, 12, 0).getTime();
  const daysAgo = (n: number) => now / 1000 - n * 86_400;
  it("names the state and the day, as the page writes one", () => {
    expect(stateWords("archived", daysAgo(0), now)).toBe("archived today");
    expect(stateWords("archived", daysAgo(1), now)).toBe("archived yesterday");
    expect(stateWords("archived", daysAgo(13), now)).toBe("archived 3 September");
    expect(stateWords("trashed", daysAgo(1), now)).toBe("in the trash since yesterday");
    expect(stateWords("trashed", daysAgo(400), now)).toBe("in the trash since 12 August 2025");
  });
  it("says nothing for an active row, and the state alone when it was never stamped", () => {
    expect(stateWords("active", daysAgo(0), now)).toBe("");
    expect(stateWords(undefined, 0, now)).toBe("");
    expect(stateWords("archived", 0, now)).toBe("archived");
    expect(stateWords("trashed", 0, now)).toBe("in the trash");
  });
});
