import { describe, expect, test } from "vitest";
import { paperAction } from "./paper-open";

describe("paperAction", () => {
  test("a PDF in the project opens in a tab, named by its path", () => {
    expect(paperAction("k", { doi: "10.1/x" }, { where: "project", path: "lit/a/k.pdf", how: "name" }, "p1")).toEqual({
      kind: "tab", path: "lit/a/k.pdf", label: "Open PDF", shown: "lit/a/k.pdf",
    });
  });

  test("a PDF outside is asked for by its key, never its path", () => {
    const action = paperAction("smith 2020", undefined, { where: "outside", path: "~/Zotero/s.pdf", how: "file" }, "p1");
    expect(action).toEqual({
      kind: "web", url: "/api/projects/p1/papers/pdf?key=smith%202020", label: "Open PDF", shown: "~/Zotero/s.pdf",
    });
  });

  test("without a PDF: the DOI, then arXiv, then the entry's address", () => {
    expect(paperAction("k", { doi: "https://doi.org/10.1063/1.459170" }, undefined, "p1")).toEqual({
      kind: "web", url: "https://doi.org/10.1063/1.459170", label: "Open DOI page",
    });
    expect(paperAction("k", { arxiv: "2101.01234", url: "https://x.org" }, undefined, "p1")).toMatchObject({
      url: "https://arxiv.org/abs/2101.01234", label: "Open arXiv page",
    });
    expect(paperAction("k", { url: "https://x.org/p" }, undefined, "p1")?.label).toBe("Open web page");
  });

  test("nothing to open is no action, and an address that runs is none", () => {
    expect(paperAction("k", {}, undefined, "p1")).toBeNull();
    expect(paperAction("k", { url: "javascript:alert(1)" }, undefined, "p1")).toBeNull();
    expect(paperAction("k", undefined, undefined, null)).toBeNull();
  });
});
