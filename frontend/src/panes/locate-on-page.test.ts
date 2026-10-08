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

describe("placeOnPage in a display", () => {
  // SyncTeX answers every line of an align with every row of it, so the
  // rows have to be told apart by their letters, which the display sets
  // in its own order.
  it("flashes the row of an align the caret's line is", async () => {
    const { runs, boxes } = page(["a = b + c (1)", "d = ef (2)"], 400);
    const text = async () => runs;
    expect(await placeOnPage("  a &= b + c \\\\", 4, boxes, text)).toEqual([boxes[0]]);
    expect(await placeOnPage("  d &= e f", 4, boxes, text)).toEqual([boxes[1]]);
  });

  it("tells apart two rows of the same letters by their order", async () => {
    const { runs, boxes } = page(["a = b + c (6)", "c = b + a (7)"], 400);
    const text = async () => runs;
    expect(await placeOnPage("  c &= b + a", 2, boxes, text)).toEqual([boxes[1]]);
    expect(await placeOnPage("  a &= b + c \\\\", 2, boxes, text)).toEqual([boxes[0]]);
  });

  it("finds a split's row inside the equation's own box", async () => {
    const { runs, boxes } = page(["u = w + z", "= q · s (5)"], 500);
    const whole: PageBox = { page: 1, x: 72, y: 514, width: 345, height: 24 };
    const text = async () => runs;
    expect(await placeOnPage("    u &= w + z \\\\", 6, [whole, ...boxes], text)).toEqual([boxes[0]]);
    expect(await placeOnPage("      &= q \\cdot s", 9, [whole, ...boxes], text)).toEqual([boxes[1]]);
  });

  it("finds a multline's row though its rows share their letters", async () => {
    const { runs, boxes } = page([
      "H = ∑ P2 a 2Ma a + ∑ p2 i 2m i",
      "+ ∑ ZaZb Rab a<b − ∑ Za rai a,i",
      "+ ∑ 1 rij i<j (4)",
    ], 300);
    const text = async () => runs;
    const line = "  + \\sum_{a<b} \\frac{Z_a Z_b}{R_{ab}} - \\sum_{a,i} \\frac{Z_a}{r_{ai}} \\\\";
    expect(await placeOnPage(line, line.indexOf("Z_a"), boxes, text)).toEqual([boxes[1]]);
    const last = "  + \\sum_{i<j} \\frac{1}{r_{ij}}";
    expect(await placeOnPage(last, 6, boxes, text)).toEqual([boxes[2]]);
  });

  it("leaves a paragraph's lines to the caret, not to their letters", async () => {
    // A paragraph line ending in a forced break is still lined up by the
    // caret when its letters are spread over several lines of type.
    const { runs, boxes } = page(typeset);
    const text = async () => runs;
    const broken = source + " \\\\";
    expect(await placeOnPage(broken, source.indexOf("When the state") + 2, boxes, text)).toEqual([boxes[1]]);
  });
});

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

  it("finds the line of type inside a column's box beside it", async () => {
    // A two-column class answers with the column as well as the lines,
    // and the column came first and owned every letter.
    const column: PageBox = { page: 1, x: 72, y: 700, width: 345, height: 660 };
    const got = await placeOnPage(source, source.indexOf("When the state") + 2, [column, ...answer], text);
    expect(got).toEqual([boxes[1]]);
  });

  it("narrows a caption's box to the line of type the caret is on", async () => {
    // A float's caption comes back as one box around all of it.
    const caption: PageBox = { page: 1, x: 72, y: 140, width: 345, height: 50 };
    const [got] = await placeOnPage(source, source.indexOf("pulled back") + 2, [caption], text);
    expect(got.height).toBeLessThan(12);
    expect(got.y).toBe(runs[2].bottom);
    expect(got.x).toBe(72);
  });

  it("keeps the other column out of a narrowed line", async () => {
    const caption: PageBox = { page: 1, x: 72, y: 140, width: 700, height: 50 };
    const other: PageRun = { str: "words in the other column", left: 420, top: runs[1].top, bottom: runs[1].bottom, width: 200 };
    const [got] = await placeOnPage(source, source.indexOf("When the state") + 2, [caption],
      async () => [...runs, other]);
    expect(got.x + got.width).toBeLessThanOrEqual(72 + 300);
  });

  it("leaves a lone box of one line as it is", async () => {
    expect(await placeOnPage(source, 10, [boxes[0]], text)).toEqual([boxes[0]]);
  });

  it("finds the footnote's line for a caret in the footnote", async () => {
    // The words after the footnote agreed with the body's line better
    // than the footnote's few words agreed with its own.
    const body = page([
      "A paragraph with maths x2 + y2 = z2 in it and a footnote1 and then the armadillo carries on to",
      "the end of the paragraph, which runs long enough to be set over three lines of type on the",
      "page at least, so that the flash can be wrong.",
    ], 136, 1);
    const note = page(["1The footnote talks of a lemur."], 675, 1);
    const line = "A paragraph with maths $x^2 + y^2 = z^2$ in it and a footnote\\footnote{The footnote talks "
      + "of a lemur.} and then the armadillo carries on to the end of the paragraph, which runs long enough "
      + "to be set over three lines of type on the page at least, so that the flash can be wrong.";
    const all = [...body.boxes, note.boxes[0]];
    const text = async () => [...body.runs, ...note.runs];
    expect(await placeOnPage(line, line.indexOf("lemur") + 2, all, text)).toEqual([note.boxes[0]]);
    expect(await placeOnPage(line, line.indexOf("armadillo") + 2, all, text)).toEqual([body.boxes[0]]);
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
