import { beforeEach, describe, expect, it } from "vitest";

import { forgetProject } from "../remember";
import { keepEditorPlace, keepPagePlace, recallEditorPlace, recallPagePlace } from "./left-off";

beforeEach(() => {
  window.localStorage.clear();
});

describe("where the writer left off", () => {
  it("keeps a place per file and per document, per project", () => {
    keepEditorPlace("p1", "chapters/one.tex", { line: 40, column: 3, top: 31 });
    keepEditorPlace("p1", "main.tex", { line: 2, column: 1, top: 1 });
    keepPagePlace("p1", "", { index: 6, fraction: 0.25 });
    keepPagePlace("p1", "thesis", { index: 1, fraction: 0 });
    expect(recallEditorPlace("p1", "chapters/one.tex")).toEqual({ line: 40, column: 3, top: 31 });
    expect(recallEditorPlace("p2", "chapters/one.tex")).toBeNull();
    expect(recallPagePlace("p1", "")).toEqual({ index: 6, fraction: 0.25 });
    expect(recallPagePlace("p1", "thesis")).toEqual({ index: 1, fraction: 0 });
  });

  it("goes when the project is forgotten", () => {
    keepEditorPlace("p1", "main.tex", { line: 9, column: 1, top: 1 });
    keepPagePlace("p1", "", { index: 2, fraction: 0.5 });
    forgetProject("p1");
    expect(recallEditorPlace("p1", "main.tex")).toBeNull();
    expect(recallPagePlace("p1", "")).toBeNull();
  });

  it("reads a corrupt or partial entry as no place", () => {
    window.localStorage.setItem("nexttex.editor.place.p1", "{not json");
    expect(recallEditorPlace("p1", "main.tex")).toBeNull();
    window.localStorage.setItem(
      "nexttex.editor.place.p1",
      JSON.stringify({ "main.tex": { line: 0, column: 1, top: 1 }, "b.tex": { line: 4 } }),
    );
    expect(recallEditorPlace("p1", "main.tex")).toBeNull();
    expect(recallEditorPlace("p1", "b.tex")).toBeNull();
    window.localStorage.setItem("nexttex.pdf.place.p1", JSON.stringify({ "": { index: -1, fraction: 0 } }));
    expect(recallPagePlace("p1", "")).toBeNull();
  });

  it("clamps a fraction a pinch pushed past the page", () => {
    keepPagePlace("p1", "", { index: 3, fraction: -0.02 });
    expect(recallPagePlace("p1", "")).toEqual({ index: 3, fraction: 0 });
  });

  it("drops the oldest files past two hundred", () => {
    for (let n = 0; n < 205; n += 1) keepEditorPlace("p1", `f${n}.tex`, { line: 1, column: 1, top: 1 });
    keepEditorPlace("p1", "f3.tex", { line: 5, column: 1, top: 1 });
    expect(recallEditorPlace("p1", "f0.tex")).toBeNull();
    // f0 to f4 went at two hundred and five; writing f3 again took f5.
    expect(recallEditorPlace("p1", "f5.tex")).toBeNull();
    expect(recallEditorPlace("p1", "f6.tex")).not.toBeNull();
    expect(recallEditorPlace("p1", "f3.tex")?.line).toBe(5);
    expect(recallEditorPlace("p1", "f204.tex")).not.toBeNull();
  });
});
