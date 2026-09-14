import { describe, expect, test } from "vitest";
import { followDecision } from "./follow-preview";

const previews = ["thesis.tex", "esi.tex"];
const owners = {
  "thesis.tex": ["thesis.tex"],
  "esi.tex": ["esi.tex"],
  "chapters/one.tex": ["thesis.tex"],
  "shared.tex": ["thesis.tex", "esi.tex"],
  "figures/plot.png": ["thesis.tex"],
};

describe("followDecision", () => {
  test("a document on the strip is shown", () => {
    expect(followDecision("esi.tex", previews, "thesis.tex", owners)).toEqual({
      kind: "show", document: "esi.tex",
    });
  });

  test("the document already in front is left alone", () => {
    expect(followDecision("thesis.tex", previews, "thesis.tex", owners)).toEqual({
      kind: "none",
    });
  });

  test("a chapter shows the document that reads it", () => {
    expect(followDecision("chapters/one.tex", previews, "esi.tex", owners)).toEqual({
      kind: "show", document: "thesis.tex",
    });
  });

  test("a part two documents read stays with the one on screen", () => {
    expect(followDecision("shared.tex", previews, "esi.tex", owners)).toEqual({
      kind: "none",
    });
    expect(followDecision("shared.tex", previews, "thesis.tex", owners)).toEqual({
      kind: "none",
    });
  });

  test("a part read only by documents not in front picks the first on the strip", () => {
    const strip = ["notes.tex", "esi.tex", "thesis.tex"];
    expect(followDecision("shared.tex", strip, "notes.tex", owners)).toEqual({
      kind: "show", document: "esi.tex",
    });
  });

  test("an unknown .tex file is asked about", () => {
    expect(followDecision("variants/acme.tex", previews, "thesis.tex", owners)).toEqual({
      kind: "ask",
    });
    expect(followDecision("new.ltx", previews, "thesis.tex", owners)).toEqual({
      kind: "ask",
    });
  });

  test("anything that is not a .tex file does nothing", () => {
    expect(followDecision("figures/plot.png", previews, "esi.tex", owners)).toEqual({
      kind: "none",
    });
    expect(followDecision("references.bib", previews, "esi.tex", owners)).toEqual({
      kind: "none",
    });
    expect(followDecision(null, previews, "esi.tex", owners)).toEqual({ kind: "none" });
  });
});

test("a script is its own answer: the pane shows its last run", () => {
  expect(followDecision("scripts/fig.py", ["main.tex"], "main.tex", {})).toEqual({
    kind: "script", path: "scripts/fig.py",
  });
  // A style sheet or a dataset beside it is nothing to preview.
  expect(followDecision("scripts/plotstyle.mplstyle", ["main.tex"], "main.tex", {})).toEqual({
    kind: "none",
  });
});
