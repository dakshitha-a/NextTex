import { describe, expect, it } from "vitest";
import {
  type Citation,
  citationScope,
  citeContext,
  citeInsertion,
  documentOf,
  fold,
  haystack,
  rankCitations,
} from "./cite-match";

const LIBRARY: Citation[] = [
  { key: "knuth1984", type: "book", title: "The TeXbook", author: "Knuth", authors: "Knuth", surnames: ["Knuth"], year: "1984", file: "refs.bib" },
  { key: "lamport1994", type: "book", title: "LaTeX: a document preparation system", author: "Lamport", authors: "Lamport", surnames: ["Lamport"], year: "1994", file: "refs.bib" },
  { key: "okafor2020", type: "article", title: "Conical intersections", author: "Lambert", authors: "Lambert, Okafor", surnames: ["Lambert", "Okafor"], year: "2020", file: "refs.bib" },
  { key: "many2021", type: "article", title: "Five people", author: "One", authors: "One, Two, Three and 2 more", surnames: ["One", "Two", "Three", "Four", "Müller"], year: "2021", file: "refs.bib" },
  { key: "other2019", type: "misc", title: "Elsewhere", author: "Else", authors: "Else", surnames: ["Else"], year: "2019", file: "thesis/other.bib" },
];

const OWNERS = {
  "main.tex": ["main.tex"],
  "refs.bib": ["main.tex"],
  "chapters/one.tex": ["main.tex"],
  "thesis/other.bib": ["thesis/thesis.tex"],
};

const rank = (segment: string, excluded: string[] = []) =>
  rankCitations(haystack(LIBRARY, OWNERS, "main.tex"), segment, new Set(excluded));
const keys = (segment: string, excluded: string[] = []) => rank(segment, excluded).map((hit) => hit.citation.key);

describe("which document a file belongs to", () => {
  it("is the one in front when it reads the file, else the first that does", () => {
    const owners = { "shared.tex": ["a.tex", "b.tex"] };
    expect(documentOf("shared.tex", owners, ["a.tex", "b.tex"], "b.tex")).toBe("b.tex");
    expect(documentOf("shared.tex", owners, ["a.tex", "b.tex", "c.tex"], "c.tex")).toBe("a.tex");
  });

  it("is the file itself when it is a document, and the one in front otherwise", () => {
    expect(documentOf("c.tex", {}, ["c.tex"], "a.tex")).toBe("c.tex");
    expect(documentOf("loose.tex", {}, ["a.tex"], "a.tex")).toBe("a.tex");
  });
});

describe("the bibliography offered", () => {
  it("is the one the document reads, through its inputs or directly", () => {
    expect(citationScope(LIBRARY, OWNERS, "main.tex").map((c) => c.key)).not.toContain("other2019");
    expect(citationScope(LIBRARY, OWNERS, "thesis/thesis.tex").map((c) => c.key)).toEqual(["other2019"]);
  });

  it("is every entry when the document reads none, so the list is never empty for that", () => {
    expect(citationScope(LIBRARY, OWNERS, "letter.tex")).toHaveLength(LIBRARY.length);
    expect(citationScope(LIBRARY, {}, "main.tex")).toHaveLength(LIBRARY.length);
  });

  it("offers a key once when two linked files both have it", () => {
    const twice = [...LIBRARY, { ...LIBRARY[0], file: "refs.bib" }];
    expect(citationScope(twice, OWNERS, "main.tex").filter((c) => c.key === "knuth1984")).toHaveLength(1);
  });
});

describe("the key being typed", () => {
  it("is what follows the last comma, spaces and all left out", () => {
    expect(citeContext("knuth1984,la", "}")).toMatchObject({ segment: "la", back: 2 });
    expect(citeContext("knuth1984, la", "}")).toMatchObject({ segment: "la", back: 2 });
    expect(citeContext("knuth1984, ", "}")).toMatchObject({ segment: "", back: 0 });
    expect(citeContext("kn", "")).toMatchObject({ segment: "kn", back: 2 });
  });

  it("knows the keys already there, before the caret and after it", () => {
    const { excluded } = citeContext("knuth1984, la", ", okafor2020} and \\cite{many2021}");
    expect([...excluded].sort()).toEqual(["knuth1984", "okafor2020"]);
  });

  it("reaches over the rest of a key the caret is inside", () => {
    expect(citeContext("kn", "uth1984, x}")).toMatchObject({ segment: "kn", forward: 7 });
  });
});

describe("ranking", () => {
  it("puts the key's start first, then anywhere in the key", () => {
    expect(keys("la")[0]).toBe("lamport1994");
    expect(keys("1984")).toEqual(["knuth1984"]);
    expect(rank("la")[0].label).toEqual([0, 2]);
  });

  it("finds an author the key does not name, and marks the surname", () => {
    const hits = rank("lamb");
    expect(hits.map((hit) => hit.citation.key)).toEqual(["okafor2020"]);
    expect(hits[0].detail).toBe("Lambert, Okafor 2020");
    expect(hits[0].detail.slice(hits[0].marks[0], hits[0].marks[1])).toBe("Lamb");
  });

  it("adds an author the short line cut, and ignores accents", () => {
    const [hit] = rank("mull");
    expect(hit.citation.key).toBe("many2021");
    expect(hit.detail).toBe("One, Two, Three and 2 more 2021, Müller");
    expect(hit.detail.slice(hit.marks[0], hit.marks[1])).toBe("Müll");
  });

  it("finds a word of the title and shows the title beside the author", () => {
    const [hit] = rank("texb");
    expect(hit.citation.key).toBe("knuth1984");
    expect(hit.label).toEqual([]);
    expect(hit.detail).toBe("Knuth 1984, The TeXbook");
    expect(hit.detail.slice(hit.marks[0], hit.marks[1])).toBe("TeXb");
  });

  it("shows a long title from the matched word, cut to fit", () => {
    const long: Citation = {
      key: "x2000", type: "article", author: "Ng", authors: "Ng", surnames: ["Ng"], year: "2000", file: "refs.bib",
      title: "A very long study of femtosecond photoelectron spectroscopy in solution",
    };
    const [hit] = rankCitations(haystack([long], {}, ""), "photo", new Set());
    expect(hit.detail.startsWith("Ng 2000, \u2026photoelectron")).toBe(true);
    expect(hit.detail.slice(hit.marks[0], hit.marks[1])).toBe("photo");
    expect(hit.detail.endsWith("\u2026")).toBe(true);
  });

  it("ranks key before surname before year before title", () => {
    // "lam" starts lamport's key, Lambert's surname, and a title word.
    expect(keys("lam")).toEqual(["lamport1994", "okafor2020"]);
    expect(keys("con")).toEqual(["okafor2020"]);
  });

  it("falls back to the key's letters in order", () => {
    const [hit] = rank("kth");
    expect(hit.citation.key).toBe("knuth1984");
    expect(hit.label).toEqual([0, 1, 3, 5]);
  });

  it("leaves out what is already cited, and offers everything else to an empty key", () => {
    expect(keys("", ["knuth1984"])).toEqual(["lamport1994", "okafor2020", "many2021"]);
    expect(keys("la", ["lamport1994"])).not.toContain("lamport1994");
  });

  it("folds one character for one, so a range stays a range", () => {
    expect(fold("Müller")).toBe("muller");
    expect(fold("Müller")).toHaveLength("Müller".length);
  });
});

describe("taking a key", () => {
  it("steps over a closing brace that is there", () => {
    expect(citeInsertion("} now", "knuth1984")).toEqual({ insert: "knuth1984", caret: 10 });
  });

  it("goes in alone before a comma, or with the list's brace further on", () => {
    expect(citeInsertion(",lamport1994}", "knuth1984")).toEqual({ insert: "knuth1984", caret: 9 });
    expect(citeInsertion(" lamport1994}", "knuth1984")).toEqual({ insert: "knuth1984", caret: 9 });
  });

  it("closes an argument left open", () => {
    expect(citeInsertion("", "knuth1984")).toEqual({ insert: "knuth1984}", caret: 10 });
    expect(citeInsertion(" and \\ref{x}", "knuth1984")).toEqual({ insert: "knuth1984}", caret: 10 });
  });
});
