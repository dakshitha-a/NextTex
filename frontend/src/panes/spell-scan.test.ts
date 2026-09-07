import { describe, expect, test } from "vitest";
import {
  normalise,
  proseWords,
  skippedLines,
  worthChecking,
} from "./spell-scan";

const words = (line: string) => proseWords(line).map((w) => w.word);

describe("what counts as prose", () => {
  test("ordinary text", () => {
    expect(words("Internal conversion proceeds through a conical intersection.")).toEqual(
      ["Internal", "conversion", "proceeds", "through", "conical", "intersection"],
    );
  });

  test("a command is not a word, but its heading is", () => {
    expect(words("\\section{Motivation and scope}")).toEqual([
      "Motivation", "and", "scope",
    ]);
  });

  test("a caption is prose", () => {
    expect(words("\\caption{Vertical excitation energies.}")).toEqual([
      "Vertical", "excitation", "energies",
    ]);
  });

  test("citation and label keys are never prose", () => {
    expect(words("as shown before~\\cite{Matsika2011} and \\label{sec:motivation}"))
      .toEqual(["shown", "before", "and"]);
  });

  test("an environment name is not prose", () => {
    expect(words("\\begin{tabular}{lcc}")).toEqual([]);
    expect(words("\\begin{equation}")).toEqual([]);
  });

  test("a package name is not prose", () => {
    expect(words("\\usepackage[margin=1in]{geometry}")).toEqual([]);
    expect(words("\\documentclass[12pt]{report}")).toEqual([]);
  });

  test("a file path is not prose", () => {
    expect(words("\\includegraphics[width=0.8\\textwidth]{figures/pes.pdf}")).toEqual([]);
  });

  test("mathematics is not prose", () => {
    expect(words("the value $S_1$ is small")).toEqual(["the", "value", "small"]);
    expect(words("$$\\alpha + \\beta$$")).toEqual([]);
  });

  test("a comment is not checked", () => {
    // Comments are notes to oneself, not the document.
    expect(words("real text % a note wiht a typo")).toEqual(["real", "text"]);
  });

  test("an optional argument is not prose", () => {
    expect(words("\\cite[p.~4]{key} follows")).toEqual(["follows"]);
  });

  test("a word broken by a command is not reported as a word", () => {
    expect(words("\\ONP{} dissociates")).toEqual(["dissociates"]);
  });

  test("prose either side of mathematics survives", () => {
    expect(words("before $x = y$ after")).toEqual(["before", "after"]);
  });
});

describe("which words are worth checking at all", () => {
  test("acronyms are spelled by their initials", () => {
    expect(worthChecking("SORCI")).toBe(false);
    expect(worthChecking("NEB")).toBe(false);
  });
  test("very short words are noise either way", () => {
    expect(worthChecking("of")).toBe(false);
    expect(worthChecking("a")).toBe(false);
  });
  test("ordinary words are", () => {
    expect(worthChecking("conical")).toBe(true);
    expect(worthChecking("Motivation")).toBe(true);
  });
});

describe("how a word is looked up", () => {
  test("case is not spelling", () => {
    expect(normalise("Motivation")).toBe("motivation");
  });
  test("a possessive is the same word", () => {
    expect(normalise("Abbey's")).toBe("abbey");
    expect(normalise("reader’s")).toBe("reader");
  });
  test("punctuation clinging to a word is dropped", () => {
    expect(normalise("well-")).toBe("well");
  });
  test("a hyphenated word keeps its hyphen", () => {
    // Checked as one token; the list holds the common ones.
    expect(normalise("well-known")).toBe("well-known");
  });
});

describe("regions that run over several lines", () => {
  const inside = (lines: string[]) => [...skippedLines(lines)].sort((a, b) => a - b);

  test("the body of a displayed equation", () => {
    expect(
      inside([
        "Before the equation.",       // 1
        "\\begin{equation}",          // 2
        "  E = mc^2 \\text{ where}",  // 3
        "\\end{equation}",            // 4
        "After it.",                  // 5
      ]),
    ).toEqual([3, 4]);
  });

  test("an align body, starred", () => {
    expect(inside(["\\begin{align*}", "  a &= b", "\\end{align*}", "x"])).toEqual([2, 3]);
  });

  test("a listing, which is code and not English at all", () => {
    expect(
      inside(["\\begin{lstlisting}", "for i in rnge(10):", "\\end{lstlisting}"]),
    ).toEqual([2, 3]);
  });

  test("a nested environment does not end the outer one early", () => {
    expect(
      inside([
        "\\begin{equation}",  // 1
        "\\begin{array}{c}",  // 2
        "  a \\\\ b",         // 3
        "\\end{array}",       // 4
        "  = c",              // 5
        "\\end{equation}",    // 6
        "prose again",        // 7
      ]),
    ).toEqual([2, 3, 4, 5, 6]);
  });

  test("display maths opened with a bracket", () => {
    expect(inside(["\\[", "  a = b", "\\]", "after"])).toEqual([2, 3]);
  });

  test("an ordinary environment is prose and is checked", () => {
    // A table holds sentences; a figure holds a caption.
    expect(inside(["\\begin{table}", "  a caption", "\\end{table}"])).toEqual([]);
    expect(inside(["\\begin{itemize}", "  \\item text", "\\end{itemize}"])).toEqual([]);
  });

  test("a document with nothing special in it", () => {
    expect(inside(["one", "two", "three"])).toEqual([]);
  });
});

describe("verbatim inline", () => {
  test("whatever follows verb is its delimiter", () => {
    expect(words("run \\verb|rnge(10)| now")).toEqual(["run", "now"]);
    expect(words("run \\verb+xyzzyy+ now")).toEqual(["run", "now"]);
  });
});
