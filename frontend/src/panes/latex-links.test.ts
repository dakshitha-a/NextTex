import { describe, expect, it } from "vitest";
import { citationFor, inputTarget, labelTarget, linkAt } from "./latex-links";

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
  labels: [{ name: "eq:flux", file: "chapters/02.tex", line: 14 }],
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
      file: "chapters/02.tex",
      line: 14,
    });
    expect(labelTarget("eq:nope", symbols)).toBeNull();
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
