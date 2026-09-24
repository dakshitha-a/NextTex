import { describe, expect, it } from "vitest";

import { headingHint, isBoldFont, tagSpans } from "./pdf-heading";

/** A page's text layer, as pdf.js leaves it: spans with a font size. */
function page(lines: Array<Array<[string, number]>>): { root: HTMLElement; spans: HTMLElement[] } {
  const root = document.createElement("div");
  const layer = document.createElement("div");
  layer.className = "nx-text-layer";
  root.append(layer);
  const spans: HTMLElement[] = [];
  for (const line of lines) {
    for (const [text, size] of line) {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.fontSize = `calc(var(--scale-factor) * ${size}px)`;
      layer.append(span);
      spans.push(span);
    }
  }
  return { root, spans };
}

describe("isBoldFont", () => {
  it("reads the names TeX's bold faces go by", () => {
    for (const name of ["ABCDEF+CMBX10", "LMRoman10-Bold", "NimbusRomNo9L-Medi",
      "SourceSerifPro-Semibold", "TeXGyreTermes-Bold", "XYZABC+LMBX12"]) {
      expect(isBoldFont(name), name).toBe(true);
    }
  });
  it("and not the regular ones", () => {
    for (const name of ["ABCDEF+CMR10", "LMRoman10-Regular", "NimbusRomNo9L-Regu",
      "SourceSerifPro-Medium", "CMMI10", undefined]) {
      expect(isBoldFont(name), String(name)).toBe(false);
    }
  });
});

describe("an unnumbered heading at body size", () => {
  // A `\paragraph{Methods.}` run in at the start of a paragraph, body size,
  // no number: bold is the only thing that says heading.
  const lines: Array<Array<[string, number]>> = [
    [["Methods.", 10], [" We measured the decay in three solvents.", 10]],
    [["The fast component is", 10], [" important", 10], [" here.", 10]],
    [["More body text to set the running size.", 10]],
  ];
  const items = [
    { str: "Methods.", fontName: "bold", hasEOL: false },
    { str: " We measured the decay in three solvents.", fontName: "roman", hasEOL: true },
    { str: "The fast component is", fontName: "roman", hasEOL: false },
    { str: " important", fontName: "bold", hasEOL: false },
    { str: " here.", fontName: "roman", hasEOL: true },
    { str: "More body text to set the running size.", fontName: "roman", hasEOL: true },
  ];

  it("is read as a heading when bold and at the start of its line", () => {
    const { root, spans } = page(lines);
    tagSpans(spans, items);
    expect(headingHint(root, spans[0], "Methods", true).heading).toBe(true);
  });

  it("but a bold word inside a sentence is not", () => {
    const { root, spans } = page(lines);
    tagSpans(spans, items);
    expect(spans[3].dataset.font).toBe("bold");
    expect(headingHint(root, spans[3], "important", true).heading).toBe(false);
  });

  it("and without the font's word it is the ordinary search, as before", () => {
    const { root, spans } = page(lines);
    tagSpans(spans, items);
    expect(headingHint(root, spans[0], "Methods").heading).toBe(false);
  });

  it("marked content makes no span and does not shift the tags", () => {
    const { spans } = page(lines);
    tagSpans(spans, [{ type: "beginMarkedContent" }, ...items]);
    expect(spans[0].dataset.font).toBe("bold");
    expect(spans[0].dataset.bol).toBe("1");
    expect(spans[1].dataset.bol).toBeUndefined();
    expect(spans[2].dataset.bol).toBe("1");
  });
});
