import { describe, expect, it } from "vitest";
import { asText, headline } from "./SubmitPanel";
import type { SubmitReport } from "../api";

const report = (over: Partial<SubmitReport> = {}): SubmitReport => ({
  document: "main.tex",
  pages: 12,
  built: 1_000_000,
  engine: "pdflatex",
  findings: [],
  counts: {},
  ...over,
});

describe("the headline", () => {
  it("says the pages, when the PDF was written and which engine wrote it", () => {
    const now = (1_000_000 + 3 * 60) * 1000;
    expect(headline(report(), now)).toBe("12 pages, built 3 min ago with pdflatex");
    expect(headline(report({ pages: 1, built: 1_000_000 - 1 }), now)).toBe(
      "1 page, built 3 min ago with pdflatex",
    );
  });

  it("scales the age and leaves out what it does not know", () => {
    expect(headline(report({ built: 1_000_000, engine: "" }), 1_000_000 * 1000 + 5000)).toBe(
      "12 pages, built just now",
    );
    expect(headline(report({ built: 1_000_000 }), (1_000_000 + 7200) * 1000)).toBe(
      "12 pages, built 2 h ago with pdflatex",
    );
    expect(headline(report({ built: 1_000_000 }), (1_000_000 + 3 * 86400) * 1000)).toBe(
      "12 pages, built 3 d ago with pdflatex",
    );
    expect(headline(report({ pages: null, built: null }))).toBe("");
  });
});

describe("copy all", () => {
  it("writes one line per row with its place first", () => {
    const text = asText(report({
      findings: [
        { kind: "today", severity: "warning", message: "\\today", file: "main.tex", line: 4, page: null, source: "submit", explain: null },
        { kind: "image", severity: "warning", message: "low", file: null, line: null, page: 2, source: "submit", explain: null },
        { kind: "font", severity: "error", message: "CMR10 is not embedded", file: null, line: null, page: null, source: "submit", explain: null },
      ],
    }));
    expect(text.split("\n")).toEqual([
      "main.tex:4: \\today",
      "page 2: low",
      "CMR10 is not embedded",
    ]);
  });
});
