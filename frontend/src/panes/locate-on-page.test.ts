import { describe, expect, it } from "vitest";
import { placeOnPage, settingLine, type PageBox, type PageRun } from "./locate-on-page";

/** A page set as lines of type 12 points apart, each one run and one box
 *  the width of the text block, the way pdfTeX sets a paragraph. */
function page(lines: string[], first = 100, number = 1) {
  const runs: PageRun[] = lines.map((str, i) => ({
    str, left: 72, top: first + i * 12 - 7, bottom: first + i * 12, width: 300,
  }));
  const boxes: PageBox[] = lines.map((_, i) => ({
    page: number, x: 72, y: first + i * 12 + 2, width: 345, height: 9,
  }));
  return { runs, boxes };
}

const typeset = [
  "The model predicts the state, and the model then corrects the",
  "state using the model of the noise. When the state drifts, the",
  "model is told about the drift, and the state is pulled back to-",
  "wards what the model expected of the state.",
];
const source = "The model predicts the state, and the model then corrects the state using the model of "
  + "the noise. When the state drifts, the model is told about the drift, and the state is pulled "
  + "back towards what the model expected of the state.";

describe("placeOnPage", () => {
  const { runs, boxes } = page(typeset);
  // SyncTeX's own order, which is not the page's.
  const answer = [boxes[2], boxes[0], boxes[3], boxes[1], boxes[2]];
  const text = async () => runs;

  it("flashes the line of type the caret is on, not the first box", async () => {
    const at = source.indexOf("When the state");
    expect(await placeOnPage(source, at + 2, answer, text)).toEqual([boxes[1]]);
  });

  it("knows a word broken across lines of type by a hyphen", async () => {
    expect(await placeOnPage(source, source.indexOf("towards") + 6, answer, text)).toEqual([boxes[3]]);
  });

  it("puts a caret at a word's start with that word on the next line", async () => {
    // "state using" starts the second line.
    const at = source.indexOf("state using");
    expect(await placeOnPage(source, at, answer, text)).toEqual([boxes[1]]);
  });

  it("puts a caret at a word's end with the line that word ends", async () => {
    // "the" ends the first line.
    const at = source.indexOf("corrects the") + "corrects the".length;
    expect(await placeOnPage(source, at, answer, text)).toEqual([boxes[0]]);
  });

  it("takes the caret after the closing full stop to the last line", async () => {
    expect(await placeOnPage(source, source.length, answer, text)).toEqual([boxes[3]]);
  });

  it("finds the body's line and not the footnote's beside a footnote", async () => {
    const body = page(["The method1 works well, as the table shows."], 300, 2);
    const note = page(["1See the appendix for marginalia details."], 650, 2);
    const line = "The method\\footnote{See the appendix for marginalia details.} works well, as the table shows.";
    const got = await placeOnPage(line, line.indexOf("works"), [note.boxes[0], body.boxes[0]],
      async () => [...body.runs, ...note.runs]);
    expect(got).toEqual([body.boxes[0]]);
  });

  it("flashes every box when the page's text cannot be had", async () => {
    expect(await placeOnPage(source, 10, answer, async () => null)).toHaveLength(4);
  });

  it("flashes every box when nothing agrees", async () => {
    expect(await placeOnPage("Entirely different words here, all of them.", 5, answer, text)).toHaveLength(4);
  });

  it("flashes a display once, not once for each box inside it", async () => {
    const display: PageBox = { page: 1, x: 200, y: 400, width: 200, height: 30 };
    const row: PageBox = { page: 1, x: 260, y: 395, width: 80, height: 12 };
    expect(await placeOnPage("  E = \\sum_i x_i", 3, [row, display, row], async () => [])).toEqual([display]);
  });
});

describe("settingLine", () => {
  const lines = [
    "\\documentclass{article}",
    "\\usepackage{amsmath}",
    "\\begin{document}",
    "",
    "A paragraph of text.",
    "\\begin{equation}",
    "  E = mc^2",
    "  \\label{eq:e}",
    "\\end{equation}",
    "",
    "% a comment",
    "Another paragraph.",
    "\\end{document}",
  ];

  it("places nothing for a caret in the preamble", () => {
    expect(settingLine(lines, 2, 5)).toBeNull();
    expect(settingLine(lines, 3, 0)).toBeNull();
  });

  it("keeps a line that sets text", () => {
    expect(settingLine(lines, 5, 3)).toEqual({ line: 5, column: 3 });
  });

  it("goes from an environment's end up to what it set", () => {
    expect(settingLine(lines, 9, 0)).toEqual({ line: 7, column: lines[6].length });
  });

  it("goes to the nearer of two neighbours, and up when they are as near", () => {
    expect(settingLine(lines, 10, 0)).toEqual({ line: 12, column: 0 });
    expect(settingLine(["\\begin{document}", "One.", "", "Two."], 3, 0)).toEqual({ line: 2, column: 4 });
  });

  it("goes from a label to the equation above it", () => {
    expect(settingLine(lines, 8, 4)).toEqual({ line: 7, column: lines[6].length });
  });

  it("goes down from a blank line with nothing set above it", () => {
    expect(settingLine(lines, 4, 0)).toEqual({ line: 5, column: 0 });
  });

  it("stays out of the end of the document", () => {
    expect(settingLine(lines, 13, 0)).toEqual({ line: 12, column: lines[11].length });
  });

  it("reads a chapter with no preamble as all body", () => {
    expect(settingLine(["", "Text."], 1, 0)).toEqual({ line: 2, column: 0 });
  });
});
