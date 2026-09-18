import { describe, expect, it } from "vitest";
import {
  citationFor, imageTarget, inputTarget, labelSays, labelTarget, linkAt,
} from "./latex-links";

const at = (line: string, column: number) => linkAt(line, column);

describe("linkAt", () => {
  it("finds a reference from inside its braces", () => {
    const found = at("see \\ref{eq:flux} again", 10);
    expect(found).toMatchObject({ kind: "ref", name: "eq:flux" });
  });

  it("finds it from the command name too, because the braces are narrow", () => {
    expect(at("see \\ref{eq:flux}", 5)).toMatchObject({ name: "eq:flux" });
  });

  it("knows the whole reference family, and the starred forms", () => {
    for (const command of ["eqref", "autoref", "cref", "Cref", "pageref"]) {
      expect(at(`\\${command}{a:b}`, 3)).toMatchObject({ kind: "ref" });
    }
    expect(at("\\cref*{a:b}", 3)).toMatchObject({ kind: "ref" });
  });

  it("does not match a command that merely starts the same way", () => {
    expect(at("\\reflectbox{x}", 3)).toBeNull();
    expect(at("\\citation{x}", 3)).toBeNull();
  });

  it("reads past an optional argument", () => {
    const found = at("\\cite[p. 3]{knuth}", 13);
    expect(found).toMatchObject({ kind: "cite", name: "knuth" });
  });

  it("picks the key the pointer is on when there are several", () => {
    const line = "\\cite{alpha,beta}";
    expect(at(line, 8)).toMatchObject({ name: "alpha" });
    expect(at(line, 14)).toMatchObject({ name: "beta" });
  });

  it("marks where the name is, not where the call is", () => {
    const found = at("see \\ref{eq:flux}", 10)!;
    expect("see \\ref{eq:flux}".slice(found.from, found.to)).toBe("eq:flux");
  });

  it("finds an include as an input", () => {
    expect(at("\\include{chapters/one}", 12)).toMatchObject({
      kind: "input",
      name: "chapters/one",
    });
  });

  it("says nothing about ordinary prose or an empty pair", () => {
    expect(at("a sentence with braces {here}", 25)).toBeNull();
    expect(at("\\ref{}", 5)).toBeNull();
  });
});

const symbols = {
  labels: [
    { name: "eq:flux", file: "chapters/02.tex", line: 14 },
    { name: "fig:one", file: "chapters/02.tex", line: 30, number: "3", page: "7", kind: "figure" },
    { name: "sec:odd", file: "main.tex", line: 2, number: "2.1", page: "9", kind: "mystery" },
    { name: "eq:plain", file: "main.tex", line: 5, number: "4", page: "" },
  ],
  citations: [
    { key: "knuth", type: "book", title: "The Art", author: "Knuth", year: "1968" },
  ],
  images: [],
  texfiles: ["main.tex", "chapters/one.tex"],
  commands: [],
  environments: [],
};

describe("where a link goes", () => {
  it("finds the file and line of a label", () => {
    expect(labelTarget("eq:flux", symbols)).toEqual({
      name: "eq:flux",
      file: "chapters/02.tex",
      line: 14,
    });
    expect(labelTarget("eq:nope", symbols)).toBeNull();
  });

  it("says what a reference will say once the document has been built", () => {
    // The kind hyperref's anchor names, its number, and the page.
    expect(labelSays(labelTarget("fig:one", symbols))).toBe("Figure 3, on page 7");
    // A kind nothing here names is shown by its number alone.
    expect(labelSays(labelTarget("sec:odd", symbols))).toBe("2.1, on page 9");
    // No hyperref: a number with no page and no kind.
    expect(labelSays(labelTarget("eq:plain", symbols))).toBe("4");
    // Before the first build there is nothing to say.
    expect(labelSays(labelTarget("eq:flux", symbols))).toBeNull();
    expect(labelSays(null)).toBeNull();
  });

  it("finds a figure with the suffix left off, and finds an includegraphics as an image", () => {
    const table = { ...symbols, images: ["figures/plot.pdf", "figures/plot.png", "figures/plots/x.png"] };
    expect(imageTarget("figures/plot.pdf", table)).toBe("figures/plot.pdf");
    expect(imageTarget("figures/plot", table)).toBe("figures/plot.pdf");
    expect(imageTarget("./figures/plot", table)).toBe("figures/plot.pdf");
    expect(imageTarget("figures/plots", table)).toBeNull();
    expect(imageTarget("nope", table)).toBeNull();
    expect(linkAt("\\includegraphics[width=\\linewidth]{figures/plot}", 40)?.kind).toBe("image");
  });

  it("adds the suffix an input almost always leaves off", () => {
    expect(inputTarget("chapters/one", symbols)).toBe("chapters/one.tex");
    expect(inputTarget("./chapters/one.tex", symbols)).toBe("chapters/one.tex");
    expect(inputTarget("chapters/two", symbols)).toBeNull();
  });

  it("finds a bibliography entry by key", () => {
    expect(citationFor("knuth", symbols)?.author).toBe("Knuth");
    expect(citationFor("nobody", symbols)).toBeNull();
  });
});
