import { describe, expect, it } from "vitest";

import { LONG_LIST, matches, sortKeyFrom, sortProjects, visibleProjects } from "./project-filter";
import { rowAfterKey } from "./project-row";

const thesis = { name: "thesis", path: "/home/d/writing/Thesis-2027" };

describe("the project filter", () => {
  it("matches nothing typed to everything", () => {
    expect(matches(thesis, "")).toBe(true);
    expect(matches(thesis, "   ")).toBe(true);
  });

  it("matches a word in the name or the path, case regardless", () => {
    expect(matches(thesis, "THE")).toBe(true);
    expect(matches(thesis, "writing")).toBe(true);
    expect(matches(thesis, "poster")).toBe(false);
  });

  it("wants every word, wherever each one lands", () => {
    expect(matches(thesis, "thesis 2027")).toBe(true);
    expect(matches(thesis, "thesis 2026")).toBe(false);
  });

  it("calls six a long list", () => {
    expect(LONG_LIST).toBe(6);
  });
});

const rows = [
  { id: "c10", name: "chapter-10", path: "/w/chapter-10", missing: false },
  { id: "b", name: "Banana", path: "/w/banana", missing: false },
  { id: "c3", name: "chapter-3", path: "/w/chapter-3", missing: true },
  { id: "a", name: "apple", path: "/w/apple", missing: false },
  { id: "z", name: "Zed", path: "/w/zed", missing: false },
  { id: "ae", name: "Ärger", path: "/w/aerger", missing: false },
  { id: "dup2", name: "notes", path: "/w/b/notes", missing: false },
  { id: "dup1", name: "notes", path: "/w/a/notes", missing: false },
];

describe("the project order", () => {
  it("hands back the server's order untouched for recent", () => {
    expect(sortProjects(rows, "recent")).toBe(rows);
  });

  it("sorts by name as a person reads names", () => {
    const names = sortProjects(rows, "name").map((row) => row.name);
    // Case folded: apple before Banana.  Accents ignored: Ärger among the
    // As.  Numeric: chapter-3 before chapter-10.  Equal names by path.
    expect(names).toEqual([
      "apple", "Ärger", "Banana", "chapter-3", "chapter-10", "notes", "notes", "Zed",
    ]);
    const notes = sortProjects(rows, "name").filter((row) => row.name === "notes");
    expect(notes.map((row) => row.id)).toEqual(["dup1", "dup2"]);
  });

  it("keeps a missing row where the order puts it, and never mutates", () => {
    const before = [...rows];
    const sorted = sortProjects(rows, "name");
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(before);
    expect(sorted[3].missing).toBe(true);
  });

  it("reads a stored value back to a key, defaulting to recent", () => {
    expect(sortKeyFrom("name")).toBe("name");
    expect(sortKeyFrom("recent")).toBe("recent");
    expect(sortKeyFrom("garbage")).toBe("recent");
    expect(sortKeyFrom(null)).toBe("recent");
    expect(sortKeyFrom(undefined)).toBe("recent");
  });

  it("filters and then sorts, and that is the order the arrows walk", () => {
    const shown = visibleProjects(rows, "chapter", "name");
    expect(shown.map((row) => row.id)).toEqual(["c3", "c10"]);
    const order = shown.filter((row) => !row.missing).map((row) => row.id);
    expect(order).toEqual(["c10"]);
    expect(rowAfterKey(order, "c10", "ArrowDown")).toBeNull();
    // Nothing typed keeps the input array for recent, so the rows keep
    // their identity across keystrokes that clear the box.
    expect(visibleProjects(rows, "  ", "recent")).toBe(rows);
  });
});
