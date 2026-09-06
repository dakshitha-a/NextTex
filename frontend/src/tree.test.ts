import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  collisions,
  foldersIn,
  keptBothName,
  namesIn,
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
