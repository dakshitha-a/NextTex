import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  collisions,
  findNode,
  foldersIn,
  isInside,
  keptBothName,
  namesIn,
  search,
} from "./tree";
import type { TreeNode } from "./api";

const dir = (path: string, children: TreeNode[] = []): TreeNode =>
  ({ path, name: path.split("/").pop()!, type: "dir", children }) as TreeNode;
const file = (path: string): TreeNode =>
  ({ path, name: path.split("/").pop()!, type: "file" }) as TreeNode;

const tree = dir("", [
  file("main.tex"),
  file("references.bib"),
  dir("chapters", [file("chapters/02_theory.tex")]),
  dir("figures", [
    file("figures/plot.png"),
    file("figures/plot (2).png"),
    dir("figures/spectra", [file("figures/spectra/uv.png")]),
  ]),
]);

describe("foldersIn", () => {
  it("puts the project root first, since it has no row of its own", () => {
    expect(foldersIn(tree)[0]).toEqual({ path: "", name: "Project root", depth: 0 });
  });

  it("lists nested folders depth first, with a depth to indent by", () => {
    expect(foldersIn(tree).map((f) => `${f.depth}:${f.path}`)).toEqual([
      "0:", "1:chapters", "1:figures", "2:figures/spectra",
    ]);
  });

  it("says the root exists even for a project with nothing in it", () => {
    expect(foldersIn(null).map((f) => f.path)).toEqual([""]);
  });
});

describe("namesIn", () => {
  it("reads one folder, not the whole subtree", () => {
    expect([...namesIn(tree, "figures")].sort()).toEqual(
      ["plot (2).png", "plot.png", "spectra"],
    );
  });

  it("reads the root", () => {
    expect(namesIn(tree, "").has("main.tex")).toBe(true);
  });

  it("reaches a folder nested inside another", () => {
    expect([...namesIn(tree, "figures/spectra")]).toEqual(["uv.png"]);
  });

  it("is empty for a folder that is not there", () => {
    expect(namesIn(tree, "nowhere").size).toBe(0);
  });
});

describe("keptBothName", () => {
  it("numbers from two, the way the server does", () => {
    expect(keptBothName(new Set(["plot.png"]), "plot.png")).toBe("plot (2).png");
  });

  it("skips a number already taken", () => {
    expect(keptBothName(new Set(["plot.png", "plot (2).png"]), "plot.png")).toBe(
      "plot (3).png",
    );
  });

  it("keeps the extension on the end where it belongs", () => {
    expect(keptBothName(new Set(["a.tar.gz"]), "a.tar.gz")).toBe("a.tar (2).gz");
  });

  it("handles a name with no extension at all", () => {
    expect(keptBothName(new Set(["Makefile"]), "Makefile")).toBe("Makefile (2)");
  });

  it("leaves a dotfile's leading dot alone", () => {
    expect(keptBothName(new Set([".gitignore"]), ".gitignore")).toBe(
      ".gitignore (2)",
    );
  });
});

describe("collisions", () => {
  it("names only the files that are already there", () => {
    expect(collisions(tree, "figures", ["plot.png", "new.png"])).toEqual(
      ["plot.png"],
    );
  });

  it("counts a folder of that name as taken, because it is", () => {
    expect(collisions(tree, "figures", ["spectra"])).toEqual(["spectra"]);
  });
});

describe("ancestorsOf", () => {
  it("names every folder a file has to be shown inside", () => {
    expect(ancestorsOf("figures/spectra/uv.png")).toEqual([
      "figures", "figures/spectra",
    ]);
  });

  it("gives nothing for a file at the root", () => {
    expect(ancestorsOf("main.tex")).toEqual([]);
  });
});

describe("findNode", () => {
  it("finds a file several folders down", () => {
    expect(findNode(tree, "figures/spectra/uv.png")?.name).toBe("uv.png");
  });

  it("finds a folder", () => {
    expect(findNode(tree, "figures/spectra")?.type).toBe("dir");
  });

  it("answers the root for the empty path, which has no row of its own", () => {
    expect(findNode(tree, "")).toBe(tree);
  });

  it("says nothing for a path that is not there", () => {
    expect(findNode(tree, "chapters/03_missing.tex")).toBeNull();
  });

  it("says nothing rather than throwing before the tree has loaded", () => {
    expect(findNode(null, "main.tex")).toBeNull();
  });
});

describe("isInside", () => {
  it("counts a folder as inside itself, which is what refuses a move onto self", () => {
    expect(isInside("figures", "figures")).toBe(true);
  });

  it("sees a descendant", () => {
    expect(isInside("figures", "figures/spectra/uv.png")).toBe(true);
  });

  it("does not mistake a shared prefix for containment", () => {
    // The bug this exists to prevent: `figures-old` is not in `figures`,
    // and a plain startsWith says it is.
    expect(isInside("figures", "figures-old/plot.png")).toBe(false);
  });

  it("puts everything inside the project root", () => {
    expect(isInside("", "main.tex")).toBe(true);
  });
});

describe("search", () => {
  it("finds a file by part of its name, ignoring case", () => {
    expect([...search(tree, "THEORY").matches]).toEqual(["chapters/02_theory.tex"]);
  });

  it("keeps the folders on the way down, so the match can be seen", () => {
    expect([...search(tree, "uv.png").show].sort()).toEqual([
      "figures", "figures/spectra", "figures/spectra/uv.png",
    ]);
  });

  it("matches folders too", () => {
    expect(search(tree, "spectra").matches.has("figures/spectra")).toBe(true);
  });

  it("matches on the name, not the path: a folder does not drag its files in", () => {
    expect(search(tree, "chapters").matches.has("chapters/02_theory.tex")).toBe(false);
  });

  it("finds every file sharing a stem", () => {
    expect([...search(tree, "plot").matches].sort()).toEqual([
      "figures/plot (2).png", "figures/plot.png",
    ]);
  });

  it("shows nothing for an empty query, which is how the tree comes back", () => {
    expect(search(tree, "   ").show.size).toBe(0);
  });

  it("finds nothing rather than throwing before the tree has loaded", () => {
    expect(search(null, "main").matches.size).toBe(0);
  });
});
