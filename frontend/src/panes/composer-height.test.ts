import { describe, expect, it } from "vitest";
import { composerHeight } from "./composer-height";

describe("composerHeight", () => {
  it("rests at two lines when there is little to show", () => {
    expect(composerHeight(20, 60, 800, 40)).toEqual({ height: 40, scrolls: false });
  });

  it("grows with the text while the card is under half the column", () => {
    expect(composerHeight(120, 60, 800, 40)).toEqual({ height: 120, scrolls: false });
  });

  it("stops the card at half the column and scrolls the rest", () => {
    // Half of 800 is 400; the card's other 60 px leave 340 for the box.
    expect(composerHeight(900, 60, 800, 40)).toEqual({ height: 340, scrolls: true });
  });

  it("keeps its two lines in a column too short to grow in", () => {
    expect(composerHeight(300, 90, 200, 40)).toEqual({ height: 40, scrolls: true });
  });
});
