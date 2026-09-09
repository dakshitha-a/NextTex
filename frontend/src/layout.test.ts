import { describe, expect, it } from "vitest";

import {
  BREAKPOINTS,
  MIN_CHAT,
  MIN_EDITOR,
  MIN_PDF,
  MIN_RAIL,
  breakpoints,
  clampWidths,
  dragBounds,
  minPairFor,
  nextFolded,
  type Widths,
} from "./layout";

const roomy: Widths = { rail: 240, editor: 0.5, chat: 380 };
const bothOpen = { editor: false, pdf: false };

describe("breakpoints", () => {
  it("changes exactly at the stated widths and not a pixel earlier", () => {
    expect(breakpoints(BREAKPOINTS.narrow)).toEqual({ narrow: false, tight: false });
    expect(breakpoints(BREAKPOINTS.narrow - 1).narrow).toBe(true);
    expect(breakpoints(BREAKPOINTS.tight)).toEqual({ narrow: true, tight: false });
    expect(breakpoints(BREAKPOINTS.tight - 1).tight).toBe(true);
  });
});

describe("clampWidths", () => {
  const room = (width: number, over: Partial<Parameters<typeof clampWidths>[1]> = {}) => ({
    width,
    tight: false,
    railShown: true,
    chatShown: true,
    minPair: minPairFor(bothOpen),
    ...over,
  });

  it("returns the very same object when everything fits", () => {
    // Identity, not equality: the caller hands this straight to the setter,
    // and a new object with the same numbers is a render for nothing.
    expect(clampWidths(roomy, room(1920))).toBe(roomy);
  });

  it("takes from the agent before the file list", () => {
    // 1300 wide: rail 240 plus chat 380 plus 740 of middle is 1360, so 60
    // has to come from somewhere.
    const fitted = clampWidths(roomy, room(1300));
    expect(fitted.chat).toBe(320);
    expect(fitted.rail).toBe(240);
  });

  it("takes from the file list once the agent is at its floor", () => {
    const fitted = clampWidths(roomy, room(1200));
    expect(fitted.chat).toBe(MIN_CHAT);
    expect(fitted.rail).toBeLessThan(240);
    expect(fitted.rail).toBeGreaterThanOrEqual(MIN_RAIL);
  });

  it("never takes a pane below its floor in a window that can still be fitted", () => {
    const fitted = clampWidths(roomy, room(760));
    expect(fitted.rail).toBeGreaterThanOrEqual(MIN_RAIL);
    expect(fitted.chat).toBeGreaterThanOrEqual(MIN_CHAT);
  });

  it("stops squeezing below the width the layout claims", () => {
    // Under the stated minimum the frame scrolls instead.  Squeezing here as
    // well would crush the panes below widths the layout has just said it
    // will not honour, which is the state this replaced: unreachable content
    // with nothing to say it was there.
    expect(clampWidths(roomy, room(700))).toBe(roomy);
  });


  it("leaves the widths alone below the tight breakpoint", () => {
    // The middle panes take turns there, so the arithmetic above does not
    // describe the layout any more.
    expect(clampWidths(roomy, room(860, { tight: true }))).toBe(roomy);
  });

  it("ignores a pane that is not on screen", () => {
    const fitted = clampWidths(roomy, room(1100, { chatShown: false }));
    expect(fitted.chat).toBe(roomy.chat);
  });

  it("gives the middle panes their room back when one is folded", () => {
    const folded = room(1300, { minPair: minPairFor({ editor: false, pdf: true }) });
    expect(clampWidths(roomy, folded)).toBe(roomy);
  });
});

describe("dragBounds", () => {
  it("never lets a side pane take more than the middle two can give", () => {
    // The bug this encodes: 560 against a pair that refuses to go below 740.
    const bounds = dragBounds("chat", {
      pair: 800,
      anchorWidth: 380,
      minPair: MIN_EDITOR + MIN_PDF,
    });
    expect(bounds.max).toBe(380 + 60);
  });

  it("keeps its ceiling when there is room to spare", () => {
    const bounds = dragBounds("chat", {
      pair: 2000,
      anchorWidth: 380,
      minPair: MIN_EDITOR + MIN_PDF,
    });
    expect(bounds.max).toBe(560);
  });

  it("never returns a ceiling below its own floor", () => {
    const bounds = dragBounds("rail", { pair: 400, anchorWidth: 180, minPair: 740 });
    expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
  });

  it("splits the pair between the two minimums", () => {
    const bounds = dragBounds("split", { pair: 1000, anchorWidth: 500, minPair: 740 });
    expect(bounds.min).toBe(MIN_EDITOR);
    expect(bounds.max).toBe(1000 - MIN_PDF);
  });
});

describe("nextFolded", () => {
  const open = { rail: false, editor: false, pdf: false, chat: false };

  it("keeps one of the two middle panes open", () => {
    const noSource = nextFolded(open, "editor");
    expect(noSource.editor).toBe(true);
    expect(noSource.pdf).toBe(false);
    const noPreview = nextFolded(noSource, "pdf");
    expect(noPreview.pdf).toBe(true);
    expect(noPreview.editor).toBe(false);
  });

  it("unfolds without touching the other one", () => {
    const folded = nextFolded(open, "editor");
    expect(nextFolded(folded, "editor")).toEqual(open);
  });

  it("leaves the side panes to themselves", () => {
    expect(nextFolded(open, "rail").rail).toBe(true);
    expect(nextFolded(open, "chat").chat).toBe(true);
  });
});
