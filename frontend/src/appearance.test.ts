import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULTS,
  EDITOR_SIZES,
  EDITOR_WEIGHTS,
  SCALES,
  applyAppearance,
  gutterSize,
  isDefault,
  nearest,
  step,
  storedAppearance,
} from "./appearance";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("the gutter's size", () => {
  it("is a whole number of pixels at every stop on the ladder", () => {
    for (const size of EDITOR_SIZES) {
      expect(Number.isInteger(gutterSize(size))).toBe(true);
    }
  });

  it("stays close to the ratio the design specifies", () => {
    // 0.82 of the text, which is what the CSS used to compute directly; the
    // rounding is the only thing that moved, so nothing may drift further
    // than half a pixel from it.
    for (const size of EDITOR_SIZES) {
      expect(Math.abs(gutterSize(size) - size * 0.82)).toBeLessThanOrEqual(0.5);
    }
  });

  it("is published as a whole number of pixels on the root", () => {
    applyAppearance({ ...DEFAULTS, editor: 13.5 });
    // 13.5 * 0.82 is 11.07, which is what a glyph used to be set at.
    expect(
      document.documentElement.style.getPropertyValue("--nx-editor-gutter"),
    ).toBe("11px");
  });
});

describe("the size ladders", () => {
  it("steps up and down without falling off either end", () => {
    expect(step(100, SCALES, 1)).toBe(110);
    expect(step(100, SCALES, -1)).toBe(90);
    expect(step(90, SCALES, -1)).toBe(90);
    expect(step(150, SCALES, 1)).toBe(150);
  });

  it("steps the weight ladder and stops at both ends", () => {
    expect(step(400, EDITOR_WEIGHTS, 1)).toBe(500);
    expect(step(400, EDITOR_WEIGHTS, -1)).toBe(300);
    expect(step(500, EDITOR_WEIGHTS, 1)).toBe(500);
    expect(step(300, EDITOR_WEIGHTS, -1)).toBe(300);
    // A weight the light grounds add their step to would land here if it
    // were ever written back to storage, and it must not stick.
    expect(nearest(600, EDITOR_WEIGHTS)).toBe(500);
  });

  it("lands a value that is not on the ladder at the nearest rung", () => {
    // A stored value from an older ladder, or one edited by hand.
    expect(nearest(118, SCALES)).toBe(125);
    expect(nearest(14, EDITOR_SIZES)).toBe(13.5);
    expect(nearest(1000, SCALES)).toBe(150);
  });

  it("steps from off-ladder values rather than refusing to move", () => {
    expect(step(118, SCALES, 1)).toBe(150);
    expect(step(118, SCALES, -1)).toBe(110);
  });
});

describe("what is remembered", () => {
  it("defaults to a dark theme at the size the app was drawn at", () => {
    expect(storedAppearance()).toEqual(DEFAULTS);
  });

  it("reads back what was applied", () => {
    applyAppearance({
      theme: "light", scale: 125, editor: 17, editorTheme: "match",
      weight: 500, syntax: "colour", preview: "sharper", spelling: true,
    });
    expect(storedAppearance()).toEqual({
      theme: "light", scale: 125, editor: 17, editorTheme: "match",
      weight: 500, syntax: "colour", preview: "sharper", spelling: true,
    });
  });

  it("ignores a stored value that is not a size", () => {
    window.localStorage.setItem("nexttex.ui.scale", "banana");
    window.localStorage.setItem("nexttex.theme", "sepia");
    expect(storedAppearance()).toEqual(DEFAULTS);
  });

  it("stamps the document so CSS can use it", () => {
    applyAppearance({
      theme: "light", scale: 150, editor: 21, editorTheme: "match",
      weight: 300, syntax: "colour", preview: "sharper", spelling: true,
    });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--nx-ui-scale")).toBe("1.5");
    expect(root.style.getPropertyValue("--nx-editor-size")).toBe("21px");
    expect(root.style.getPropertyValue("--nx-editor-weight")).toBe("300");
    expect(root.dataset.syntax).toBe("colour");
    expect(root.dataset.spelling).toBe("on");
  });

  it("leaves spell checking off until it is asked for", () => {
    // It downloads a word list and, before the writer has taught it their
    // own vocabulary, has something to say about a great many correct words.
    expect(storedAppearance().spelling).toBe(false);
  });

  it("keeps the subtle highlighting when nothing has asked for colour", () => {
    // The default look is the one the editor has always had, and a stored
    // value nobody recognises must not quietly turn colour on.
    expect(storedAppearance().syntax).toBe("subtle");
    window.localStorage.setItem("nexttex.editor.syntax", "rainbow");
    expect(storedAppearance().syntax).toBe("subtle");
  });

  it("survives a localStorage that throws", () => {
    // A private window, or site data blocked.  A preference is never worth
    // taking the boot down for.
    const real = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("denied");
    };
    try {
      expect(storedAppearance()).toEqual(DEFAULTS);
    } finally {
      window.localStorage.getItem = real;
    }
  });

  it("knows when nothing has been changed", () => {
    expect(isDefault(DEFAULTS)).toBe(true);
    expect(isDefault({ ...DEFAULTS, scale: 110 })).toBe(false);
  });
});
