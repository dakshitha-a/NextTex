import { describe, expect, it } from "vitest";

import { placeClear } from "./place-clear";

const pane = { width: 800, height: 600 };
const row = { width: 300, height: 32 };
const card = { width: 300, height: 190 };

describe("where a thing floating over the editor goes", () => {
  it("sits above the first line of the block when there is room, clear of it", () => {
    const first = { top: 200, bottom: 221, left: 40 };
    const at = placeClear(first, { top: 263, bottom: 284, left: 40 }, pane, row);
    expect(at.top + row.height).toBeLessThanOrEqual(first.top);
    expect(at).toEqual({ left: 40, top: 200 - 4 - 32, side: "above" });
  });

  it("goes below the last line when the block starts at the top of the view", () => {
    // The clamp used to put it at the top of the pane, over the first
    // selected line, which is the case the writer reported.
    const first = { top: 10, bottom: 31, left: 40 };
    const last = { top: 94, bottom: 115, left: 40 };
    const at = placeClear(first, last, pane, row);
    expect(at.top).toBeGreaterThanOrEqual(last.bottom);
    expect(at).toEqual({ left: 40, top: 119, side: "below" });
  });

  it("falls to the foot of the pane only when the last line is off the bottom too", () => {
    const first = { top: 10, bottom: 31, left: 40 };
    const last = { top: 900, bottom: 921, left: 40 };
    const at = placeClear(first, last, pane, row);
    expect(at).toEqual({ left: 40, top: 600 - 32 - 8, side: "below" });
  });

  it("takes the edge nearest the pointer when the block fills the view", () => {
    const first = { top: 10, bottom: 31, left: 40 };
    const last = { top: 900, bottom: 921, left: 40 };
    expect(placeClear(first, last, pane, card, 120)).toEqual({ left: 40, top: 4, side: "above" });
    expect(placeClear(first, last, pane, card, 480)).toEqual({
      left: 40, top: 600 - 190 - 8, side: "below",
    });
  });

  it("goes below a wrapped paragraph whose top is off the screen", () => {
    // The boxes are line blocks, whole logical lines however many rows
    // they wrap to, so a paragraph scrolled half out of view is one tall
    // box starting above the pane: the row goes under it, not over the
    // rows still showing.
    const paragraph = { top: -60, bottom: 150, left: 40 };
    const at = placeClear(paragraph, paragraph, pane, row);
    expect(at.top).toBeGreaterThanOrEqual(paragraph.bottom);
    expect(at).toEqual({ left: 40, top: 154, side: "below" });
  });

  it("puts a tall card below a five line equation near the top, never over it", () => {
    // The hover card's case: CodeMirror pinned the card to the top of the
    // view over the equation's own lines.
    const begin = { top: 30, bottom: 52, left: 40 };
    const end = { top: 118, bottom: 140, left: 40 };
    const at = placeClear(begin, end, pane, card, 96);
    expect(at.top).toBeGreaterThanOrEqual(end.bottom);
    expect(at.side).toBe("below");
  });

  it("keeps the thing inside the pane sideways", () => {
    const first = { top: 200, bottom: 221, left: 700 };
    expect(placeClear(first, first, pane, row).left).toBe(800 - 300 - 8);
    const edge = { top: 200, bottom: 221, left: 2 };
    expect(placeClear(edge, edge, pane, row).left).toBe(8);
  });
});
