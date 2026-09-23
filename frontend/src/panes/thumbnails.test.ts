import { describe, expect, test } from "vitest";
import { BIGGEST_PICTURE, hasThumbnail } from "./thumbnails";

/** Which files get a picture, and which are too big to be worth one.
 *
 *  The card's picture is the file itself: a raster goes to an `<img>` and
 *  a PDF is read whole into an `ArrayBuffer` for its first page. That is
 *  cheap for a figure and ruinous for a very large one, and the tree
 *  already knows the size, so the question is answered before anything is
 *  fetched rather than after.
 */
describe("what gets a picture", () => {
  test("an ordinary figure does", () => {
    expect(hasThumbnail("figures/plot.png", 240_000)).toBe(true);
    expect(hasThumbnail("figures/scan.jpg", 4_000_000)).toBe(true);
    expect(hasThumbnail("figures/diagram.pdf", 900_000)).toBe(true);
    expect(hasThumbnail("figures/logo.svg", 3_000)).toBe(true);
  });

  test("a file the card could never draw does not", () => {
    expect(hasThumbnail("main.tex", 12_000)).toBe(false);
    expect(hasThumbnail("data/results.csv", 12_000)).toBe(false);
    expect(hasThumbnail("notes", 12_000)).toBe(false);
  });

  test("a very large one does not, whatever its extension", () => {
    // The 192 MiB PNG that froze a renderer for the best part of a minute.
    expect(hasThumbnail("figures/big.png", 201_393_911)).toBe(false);
    expect(hasThumbnail("figures/huge.pdf", 201_393_911)).toBe(false);
  });

  test("the line is where the constant says, and is inclusive", () => {
    expect(hasThumbnail("figures/big.png", BIGGEST_PICTURE)).toBe(true);
    expect(hasThumbnail("figures/big.png", BIGGEST_PICTURE + 1)).toBe(false);
  });

  test("a caller with no size to give still gets an answer", () => {
    // The read-only panes pass no facts at all, and a tree listing that
    // predates `size` would be the same case.
    expect(hasThumbnail("figures/plot.png")).toBe(true);
    expect(hasThumbnail("main.tex")).toBe(false);
  });

  test("the cap is far above a real figure and far below the trouble", () => {
    // Stated as a test so that moving it is a decision rather than a
    // typo: a full-page 300 dpi scan is a few megabytes, and the file
    // that caused this was two hundred.
    expect(BIGGEST_PICTURE).toBeGreaterThan(16 * 1024 * 1024);
    expect(BIGGEST_PICTURE).toBeLessThan(64 * 1024 * 1024);
  });
});
