import { describe, expect, it } from "vitest";
import { findPlace, foundOn, marksAt } from "./hold-place";
import type { PageRun } from "./locate-on-page";

/** A page set as lines of text, one run a line, twelve points apart. */
function page(lines: string[], first = 100): PageRun[] {
  return lines.map((str, index) => {
    const bottom = first + index * 24;
    return { str, left: 72, top: bottom - 9, bottom, width: str.length * 5 };
  });
}

const PARAGRAPH = [
  "The estimate of the variance follows from the",
  "residuals of the fitted model once the boundary",
  "layer has been removed from the measured signal,",
  "and the density of the remaining samples sets how",
  "far the curve can be trusted near the surface.",
];

describe("marksAt", () => {
  it("starts with the line at the eye and carries letters past its end", () => {
    const runs = page(PARAGRAPH);
    const marks = marksAt(runs, 148);
    expect(marks[0].baseline).toBe(148);
    expect(marks[0].letters.startsWith("layerhasbeen")).toBe(true);
    // Into the next line: a reflow moves the line break, not the letters.
    expect(marks[0].letters).toContain("signalandthe");
  });

  it("offers the lines around the eye after it", () => {
    const marks = marksAt(page(PARAGRAPH), 148);
    expect(marks.map((mark) => mark.baseline).slice(0, 3)).toEqual([148, 172, 124]);
  });

  it("has nothing to say about a page with no text", () => {
    expect(marksAt([], 100)).toEqual([]);
  });
});

describe("findPlace", () => {
  it("finds the reader's line after a reflow has moved it to the next page", async () => {
    const before = page(PARAGRAPH);
    // A line was added above: the paragraph's last lines now open page 3.
    const pages: Record<number, PageRun[]> = {
      2: page(["Something new pushed the paragraph down so that", ...PARAGRAPH.slice(0, 2)]),
      3: page(["layer has been removed from the measured", "signal, and the density of the remaining samples", "sets how far the curve can be trusted near the surface."]),
    };
    const marks = marksAt(before, 148);
    const place = await findPlace(marks, 2, 4, async (n) => pages[n] ?? [], false);
    expect(place).toMatchObject({ page: 3, baseline: 100 });
  });

  it("looks everywhere when the document changed shape", async () => {
    // A chapter alone had the line on page 4; the whole thesis has it on 40.
    const marks = marksAt(page(PARAGRAPH), 124);
    const read: number[] = [];
    const runsOf = async (n: number) => {
      read.push(n);
      return n === 40 ? page(PARAGRAPH) : page([`Page ${n} of the front matter and other chapters.`]);
    };
    expect(await findPlace(marks, 4, 60, runsOf, false)).toBeNull();
    expect(await findPlace(marks, 4, 60, runsOf, true)).toMatchObject({ page: 40, baseline: 124 });
  });

  it("takes the copy nearest the page the reader was on", async () => {
    const marks = marksAt(page(PARAGRAPH), 100);
    const place = await findPlace(marks, 5, 9, async (n) => (n === 3 || n === 6 ? page(PARAGRAPH) : []), false);
    expect(place?.page).toBe(6);
  });

  it("falls back to a neighbouring line when the one at the eye was edited", async () => {
    const marks = marksAt(page(PARAGRAPH), 148);
    const edited = page([
      PARAGRAPH[0], PARAGRAPH[1], "layer was taken out of the signal entirely,", PARAGRAPH[3], PARAGRAPH[4],
    ]);
    const place = await findPlace(marks, 1, 1, async () => edited, false);
    expect(place?.mark.baseline).toBe(172);
    expect(place?.baseline).toBe(172);
  });
});

describe("foundOn", () => {
  it("finds letters across runs, ignoring spaces and punctuation", () => {
    expect(foundOn(page(PARAGRAPH), "removedfromthemeasuredsignalandthe")).toEqual([148]);
  });
});
