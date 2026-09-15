import { describe, expect, it } from "vitest";

import { placeVerbRow } from "./verb-row";

const pane = { width: 800, height: 600 };
const row = { width: 300, height: 32 };

describe("where the verb row goes", () => {
  it("sits above the first selected line when there is room, clear of it", () => {
    const first = { top: 200, bottom: 221, left: 40 };
    const at = placeVerbRow(first, { top: 263, bottom: 284, left: 40 }, pane, row);
    expect(at.top + row.height).toBeLessThanOrEqual(first.top);
    expect(at).toEqual({ left: 40, top: 200 - 4 - 32 });
  });

  it("goes below the last line when the selection starts at the top of the view", () => {
    // The clamp used to put it at the top of the pane, over the first
    // selected line, which is the case the writer reported.
    const first = { top: 10, bottom: 31, left: 40 };
    const last = { top: 94, bottom: 115, left: 40 };
    const at = placeVerbRow(first, last, pane, row);
    expect(at.top).toBeGreaterThanOrEqual(last.bottom);
    expect(at).toEqual({ left: 40, top: 119 });
  });

  it("falls to the foot of the pane only when the last line is off the bottom too", () => {
    const first = { top: 10, bottom: 31, left: 40 };
    const last = { top: 900, bottom: 921, left: 40 };
    const at = placeVerbRow(first, last, pane, row);
    expect(at.top).toBe(600 - 32 - 8);
  });

  it("keeps the row inside the pane sideways", () => {
    const first = { top: 200, bottom: 221, left: 700 };
    expect(placeVerbRow(first, first, pane, row).left).toBe(800 - 300 - 8);
    const edge = { top: 200, bottom: 221, left: 2 };
    expect(placeVerbRow(edge, edge, pane, row).left).toBe(8);
  });
});
