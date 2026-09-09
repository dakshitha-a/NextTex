import { describe, expect, it } from "vitest";

import {
  MAX_CANVAS_AREA,
  backingFor,
  rasterKey,
  resolutionFor,
} from "./pdf-raster";

describe("resolutionFor", () => {
  it("leaves balanced exactly as the pane behaved before the setting existed", () => {
    // The old expression, kept here as the thing to match: an install that
    // never opens the control must see no change at all.
    const old = (dpr: number, ui: number) => Math.min((dpr || 1) * ui, 3);
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const ui of [0.9, 1, 1.1, 1.25, 1.5]) {
        expect(resolutionFor(dpr, ui, "balanced")).toBe(old(dpr, ui));
      }
    }
  });

  it("gives three different answers where there is room between them", () => {
    expect(resolutionFor(2, 1, "faster")).toBe(1.5);
    expect(resolutionFor(2, 1, "balanced")).toBe(2);
    expect(resolutionFor(2, 1, "sharper")).toBe(3);
  });

  it("cannot draw fewer pixels than the box on an ordinary screen", () => {
    // At a device ratio of 1 there is nothing for `faster` to save without
    // blurring the page deliberately, so it agrees with `balanced`.
    expect(resolutionFor(1, 1, "faster")).toBe(1);
    expect(resolutionFor(1, 1, "balanced")).toBe(1);
  });

  it("holds its ceilings", () => {
    expect(resolutionFor(4, 1.5, "balanced")).toBe(3);
    expect(resolutionFor(4, 1.5, "sharper")).toBe(4);
    expect(resolutionFor(4, 1.5, "faster")).toBe(1.5);
  });

  it("treats a missing device ratio as one rather than as zero", () => {
    expect(resolutionFor(0, 1, "balanced")).toBe(1);
  });
});

describe("backingFor", () => {
  it("reproduces the CSS box at fractional scales, which is the whole bug", () => {
    // Fit-width almost always lands on a fraction.  The box and the store
    // used to be floored independently, so the real ratio was off by a
    // fraction of a pixel and every page was resampled by a factor near one.
    for (const scale of [0.734, 1.317, 1.05, 2.718]) {
      const cssWidth = 612 * scale;
      const cssHeight = 792 * scale;
      const backing = backingFor(cssWidth, cssHeight, 2);
      const box = Math.floor(cssWidth);
      expect(Math.abs(backing.width / box - backing.ratio)).toBeLessThan(
        1 / box,
      );
    }
  });

  it("reduces the ratio and never the box when the guard bites", () => {
    const backing = backingFor(2000, 3000, 4, 1_000_000);
    expect(backing.ratio).toBeLessThan(4);
    expect(backing.width * backing.height).toBeLessThanOrEqual(1_000_000);
    // The page is the same size on screen; it is only drawn with less.
    // Within a pixel, because the store is floored to whole device pixels.
    expect(Math.abs(backing.width / backing.ratio - 2000)).toBeLessThan(2);
  });

  it("leaves an ordinary page alone", () => {
    const backing = backingFor(612, 792, 2);
    expect(backing.ratio).toBe(2);
    expect(backing.width).toBe(1224);
    expect(backing.height).toBe(1584);
  });

  it("survives a page with no size yet", () => {
    const backing = backingFor(0, 0, 2);
    expect(Number.isFinite(backing.ratio)).toBe(true);
    expect(backing.width).toBeGreaterThan(0);
    expect(backing.height).toBeGreaterThan(0);
  });

  it("keeps A4 at full zoom on a retina screen inside the ceiling", () => {
    // 595 by 842 points at zoom 3 and a device ratio of 2 is the case the
    // guard exists for: a tablet browser refuses that allocation and paints
    // nothing rather than complaining.
    const backing = backingFor(595 * 3, 842 * 3, 2);
    expect(backing.width * backing.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
  });
});

describe("rasterKey", () => {
  it("ignores a difference no eye and no pixel can carry", () => {
    expect(rasterKey(2.0000001)).toBe(rasterKey(2));
    expect(rasterKey(2.5)).not.toBe(rasterKey(2));
  });
});
