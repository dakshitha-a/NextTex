import { describe, expect, it } from "vitest";
import { rank, score } from "./palette-rank";
import { fileItems, settingItems } from "./palette-items";
import { DEFAULTS, EDITOR_GROUNDS, EDITOR_SIZES } from "./appearance";

describe("ranking what was typed", () => {
  it("matches a subsequence, case-folded, and nothing else", () => {
    expect(score("fld", "Fold the section")).not.toBeNull();
    expect(score("FLD", "fold the section")).not.toBeNull();
    expect(score("xyz", "Fold the section")).toBeNull();
    expect(score("", "anything")).toBe(0);
  });

  it("prefers word starts and runs of letters", () => {
    const labels = ["Show or hide the agent", "Save now"];
    expect(rank("sa", labels, (x) => x)[0]).toBe("Save now");
    expect(rank("dl pdf", ["Download the whole project as a zip", "Download the PDF"], (x) => x)[0])
      .toBe("Download the PDF");
  });

  it("with nothing typed keeps the order given", () => {
    expect(rank("  ", ["b", "a"], (x) => x)).toEqual(["b", "a"]);
  });

  it("prefers the shorter of two labels that match alike", () => {
    expect(rank("tab", ["Next tab in the strip", "Next tab"], (x) => x)[0]).toBe("Next tab");
  });
});

describe("the palette's settings", () => {
  it("has a row per ground and per size, and marks the current one", () => {
    const items = settingItems();
    const grounds = items.filter((item) => item.id.startsWith("ground:"));
    expect(grounds.length).toBe(EDITOR_GROUNDS.length);
    const sizes = items.filter((item) => item.id.startsWith("editor:"));
    expect(sizes.length).toBe(EDITOR_SIZES.length);
    const current = items.filter((item) => item.current(DEFAULTS)).map((item) => item.id);
    expect(current).toContain("ground:match");
    expect(current).toContain("spelling:off");
    expect(current).toContain(`editor:${DEFAULTS.editor}`);
  });

  it("applies one value and leaves the rest", () => {
    const white = settingItems().find((item) => item.id === "ground:white")!;
    const next = white.apply(DEFAULTS);
    expect(next.editorTheme).toBe("white");
    expect(next.theme).toBe(DEFAULTS.theme);
  });

  it("lists every file in the tree, folders walked", () => {
    const tree = {
      name: "p", path: "", type: "dir" as const,
      children: [
        { name: "main.tex", path: "main.tex", type: "file" as const },
        { name: "chapters", path: "chapters", type: "dir" as const, children: [
          { name: "one.tex", path: "chapters/one.tex", type: "file" as const },
        ] },
      ],
    };
    expect(fileItems(tree)).toEqual(["main.tex", "chapters/one.tex"]);
    expect(fileItems(null)).toEqual([]);
  });
});
