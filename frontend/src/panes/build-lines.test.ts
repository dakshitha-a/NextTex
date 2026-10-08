import { describe, expect, it } from "vitest";
import { BuildLines, carryColumn, mapLine } from "./build-lines";

const lines = (n: number, prefix = "line") => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

describe("mapLine", () => {
  const before = lines(10).join("\n");

  it("leaves a line where it was when nothing changed", () => {
    expect(mapLine(before, before, 7)).toBe(7);
  });

  it("moves a line down past lines added above it, and not one above them", () => {
    const after = [...lines(2), ...lines(50, "new"), ...lines(10).slice(2)].join("\n");
    expect(mapLine(before, after, 1)).toBe(1);
    expect(mapLine(before, after, 3)).toBe(53);
    expect(mapLine(before, after, 10)).toBe(60);
  });

  it("moves a line up past lines deleted above it", () => {
    const after = [...lines(10).slice(0, 2), ...lines(10).slice(5)].join("\n");
    expect(mapLine(before, after, 6)).toBe(3);
    // A deleted line is where it stood: the line after the ones before it.
    expect(mapLine(before, after, 4)).toBe(3);
  });

  it("keeps a line rewritten in place on its own line", () => {
    const after = lines(10).map((l, i) => (i === 4 ? "a rewritten paragraph" : l)).join("\n");
    expect(mapLine(before, after, 5)).toBe(5);
    expect(mapLine(before, after, 6)).toBe(6);
  });

  it("follows edits in two places", () => {
    const a = lines(10);
    const after = ["new top", ...a.slice(0, 5), "new middle", "another", ...a.slice(5)].join("\n");
    expect(mapLine(before, after, 3)).toBe(4);
    expect(mapLine(before, after, 8)).toBe(11);
  });
});

describe("BuildLines", () => {
  it("maps through the build whose PDF is on screen, not one still running", () => {
    const b = new BuildLines();
    const built = lines(5).join("\n");
    b.started("main", new Map([["main.tex", built]]));
    b.finished("main", false);
    // A second build starts after more writing, and has not finished.
    const later = ["added", ...lines(5)].join("\n");
    b.started("main", new Map([["main.tex", later]]));
    const now = ["added", "added again", ...lines(5)].join("\n");
    expect(b.map("main", "main.tex", 3, now)).toBe(5);
  });

  it("keeps the old snapshot when the build kept the last PDF", () => {
    const b = new BuildLines();
    b.started("main", new Map([["main.tex", lines(5).join("\n")]]));
    b.finished("main", false);
    b.started("main", new Map([["main.tex", ["broken {", ...lines(5)].join("\n")]]));
    b.finished("main", true);
    const now = ["broken {", ...lines(5)].join("\n");
    expect(b.map("main", "main.tex", 2, now)).toBe(3);
  });

  it("keeps each document's snapshot through a build of the other", () => {
    const b = new BuildLines();
    const built = lines(5).join("\n");
    b.started("main", new Map([["chapter.tex", built]]));
    b.finished("main", false);
    // Fifty lines written, then the supplement, which inputs the same
    // chapter, is built and shown in its own tab.
    const now = [...lines(50, "new"), ...lines(5)].join("\n");
    b.started("si", new Map([["chapter.tex", now]]));
    b.finished("si", false);
    expect(b.map("main", "chapter.tex", 3, now)).toBe(53);
    expect(b.map("si", "chapter.tex", 53, now)).toBe(53);
  });

  it("knows nothing of a file it has no snapshot of", () => {
    expect(new BuildLines().map("main", "other.tex", 12, "x")).toBe(12);
  });
});

describe("toBuilt", () => {
  it("carries the caret back past lines written while the build ran", () => {
    const b = new BuildLines();
    const built = ["\\begin{document}", "First paragraph.", "", "Second paragraph."].join("\n");
    b.started("main", new Map([["main.tex", built]]));
    b.finished("main", false);
    const now = ["\\begin{document}", "A new one.", "", "First paragraph.", "", "Second paragraph."].join("\n");
    expect(b.toBuilt("main", "main.tex", 6, 7, now)).toMatchObject({ line: 4, column: 7 });
  });

  it("reads a file opened after the build began as it was opened", () => {
    // The build a project starts as it opens snapshots no file, since the
    // editor has none yet.
    const b = new BuildLines();
    const opened = ["\\begin{document}", "First paragraph.", "", "Second paragraph."].join("\n");
    b.started("main", new Map());
    b.opened("main.tex", opened);
    b.finished("main", false);
    const now = ["\\begin{document}", "A new one.", "", "First paragraph.", "", "Second paragraph."].join("\n");
    expect(b.toBuilt("main", "main.tex", 6, 0, now)).toMatchObject({ line: 4 });
    // A build that read the file from the editor takes over.
    b.started("main", new Map([["main.tex", now]]));
    b.finished("main", false);
    expect(b.toBuilt("main", "main.tex", 6, 0, now)).toMatchObject({ line: 6 });
  });

  it("reads the text as it is when no build of the document is known", () => {
    const b = new BuildLines();
    expect(b.toBuilt("main", "main.tex", 2, 3, "a\nbcdef")).toEqual({ lines: ["a", "bcdef"], line: 2, column: 3 });
  });

  it("keeps a column before an edit on the line and after it", () => {
    expect(carryColumn("the cat sat", "the black cat sat", 2)).toBe(2);
    expect(carryColumn("the cat sat", "the black cat sat", 9)).toBe(15);
    expect(carryColumn("the cat sat", "the dog sat", 5)).toBe(4);
  });
});

describe("changedColumn", () => {
  it("finds where on its line the last build differs from the one before", () => {
    const b = new BuildLines();
    b.started("main", new Map([["main.tex", "intro\nThe model is good."]]));
    b.finished("main", false);
    b.started("main", new Map([["main.tex", "intro\nadded\nThe model is very good."]]));
    b.finished("main", false);
    expect(b.changedColumn("main", "main.tex", 3)).toBe(13);
    expect(b.changedColumn("main", "main.tex", 1)).toBe(0);
  });
});
