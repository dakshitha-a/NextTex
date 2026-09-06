import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULTS,
  EDITOR_SIZES,
  SCALES,
  applyAppearance,
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

describe("the size ladders", () => {
  it("steps up and down without falling off either end", () => {
    expect(step(100, SCALES, 1)).toBe(110);
    expect(step(100, SCALES, -1)).toBe(90);
    expect(step(90, SCALES, -1)).toBe(90);
    expect(step(150, SCALES, 1)).toBe(150);
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
    applyAppearance({ theme: "light", scale: 125, editor: 17 });
    expect(storedAppearance()).toEqual({ theme: "light", scale: 125, editor: 17 });
  });

  it("ignores a stored value that is not a size", () => {
    window.localStorage.setItem("nexttex.ui.scale", "banana");
    window.localStorage.setItem("nexttex.theme", "sepia");
    expect(storedAppearance()).toEqual(DEFAULTS);
  });

  it("stamps the document so CSS can use it", () => {
    applyAppearance({ theme: "light", scale: 150, editor: 21 });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--nx-ui-scale")).toBe("1.5");
    expect(root.style.getPropertyValue("--nx-editor-size")).toBe("21px");
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
