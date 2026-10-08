import { describe, expect, it } from "vitest";
import { BuildLines, mapLine } from "./build-lines";

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
    b.started(new Map([["main.tex", built]]));
    b.finished(false);
    // A second build starts after more writing, and has not finished.
    const later = ["added", ...lines(5)].join("\n");
    b.started(new Map([["main.tex", later]]));
    const now = ["added", "added again", ...lines(5)].join("\n");
    expect(b.map("main.tex", 3, now)).toBe(5);
  });

  it("keeps the old snapshot when the build kept the last PDF", () => {
    const b = new BuildLines();
    b.started(new Map([["main.tex", lines(5).join("\n")]]));
    b.finished(false);
    b.started(new Map([["main.tex", ["broken {", ...lines(5)].join("\n")]]));
    b.finished(true);
    const now = ["broken {", ...lines(5)].join("\n");
    expect(b.map("main.tex", 2, now)).toBe(3);
  });

  it("knows nothing of a file it has no snapshot of", () => {
    expect(new BuildLines().map("other.tex", 12, "x")).toBe(12);
  });
});
