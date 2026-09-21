import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULTS,
  EDITOR_SIZES,
  EDITOR_WEIGHTS,
  HOVER_KINDS,
  SCALES,
  applyAppearance,
  gutterSize,
  hoverCards,
  hoverCardsFrom,
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
      weight: 500, syntax: "colour", emphasis: "plain", preview: "sharper",
      spelling: true, spellingVariety: "british", keymap: "vim",
      hover: false, hoverKinds: { ...DEFAULTS.hoverKinds, figures: false },
    });
    expect(storedAppearance()).toEqual({
      theme: "light", scale: 125, editor: 17, editorTheme: "match",
      weight: 500, syntax: "colour", emphasis: "plain", preview: "sharper",
      spelling: true, spellingVariety: "british", keymap: "vim",
      hover: false, hoverKinds: { ...DEFAULTS.hoverKinds, figures: false },
    });
  });

  it("reads a retired editor ground as the theme's own", () => {
    // Six grounds became two in the visual overhaul; a browser that had
    // chosen one of the four that went must not come back on a ground
    // the stylesheet no longer has.
    for (const retired of ["light", "dark", "warm", "cool"]) {
      window.localStorage.setItem("nexttex.editor.theme", retired);
      expect(storedAppearance().editorTheme, retired).toBe("match");
    }
    window.localStorage.setItem("nexttex.editor.theme", "white");
    expect(storedAppearance().editorTheme).toBe("white");
  });

  it("ignores a stored value that is not a size", () => {
    window.localStorage.setItem("nexttex.ui.scale", "banana");
    window.localStorage.setItem("nexttex.theme", "sepia");
    expect(storedAppearance()).toEqual(DEFAULTS);
  });

  it("stamps the document so CSS can use it", () => {
    applyAppearance({
      theme: "light", scale: 150, editor: 21, editorTheme: "match",
      weight: 300, syntax: "colour", emphasis: "plain", preview: "sharper",
      spelling: true, spellingVariety: "american", keymap: "emacs",
      hover: true, hoverKinds: { ...DEFAULTS.hoverKinds, maths: false, cites: false },
    });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.keymap).toBe("emacs");
    expect(root.dataset.hoverCards).toBe("tables figures refs files");
    expect(root.style.getPropertyValue("--nx-ui-scale")).toBe("1.5");
    expect(root.style.getPropertyValue("--nx-editor-size")).toBe("21px");
    expect(root.style.getPropertyValue("--nx-editor-weight")).toBe("300");
    expect(root.dataset.syntax).toBe("colour");
    expect(root.dataset.emphasis).toBe("plain");
    expect(root.dataset.spelling).toBe("on");
    expect(root.dataset.spellingVariety).toBe("american");
  });

  it("follows the document's English until a variety is chosen", () => {
    // The default has to be the one that underlines nothing it did not
    // underline yesterday: a project that says which English it is written
    // in is held to that, and one that says nothing accepts both spellings.
    expect(storedAppearance().spellingVariety).toBe("follow");
    window.localStorage.setItem("nexttex.editor.spelling.variety", "australian");
    expect(storedAppearance().spellingVariety).toBe("follow");
    window.localStorage.setItem("nexttex.editor.spelling.variety", "british");
    expect(storedAppearance().spellingVariety).toBe("british");
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

  it("keeps the commands bold until plain is asked for by name", () => {
    // Weight is what the subtle look runs on, so the default has to stay
    // bold, and a stored value nobody recognises must not quietly turn it
    // off.
    expect(storedAppearance().emphasis).toBe("bold");
    window.localStorage.setItem("nexttex.editor.emphasis", "thin");
    expect(storedAppearance().emphasis).toBe("bold");
    window.localStorage.setItem("nexttex.editor.emphasis", "plain");
    expect(storedAppearance().emphasis).toBe("plain");
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
    expect(isDefault({ ...DEFAULTS, hover: false })).toBe(false);
    expect(isDefault({ ...DEFAULTS, hoverKinds: { ...DEFAULTS.hoverKinds, tables: false } })).toBe(false);
  });
});

describe("the hover cards", () => {
  it("are every kind until a writer chooses", () => {
    expect(storedAppearance().hover).toBe(true);
    expect(Object.values(storedAppearance().hoverKinds).every(Boolean)).toBe(true);
    // A bare document, before applyAppearance has stamped it, draws
    // every card: absence is not the switch off.
    delete document.documentElement.dataset.hoverCards;
    expect(hoverCards()).toEqual(new Set(HOVER_KINDS));
  });

  it("stamps nothing at all while the switch is off, which reads as none", () => {
    applyAppearance({ ...DEFAULTS, hover: false });
    expect(document.documentElement.dataset.hoverCards).toBe("");
    expect(hoverCards().size).toBe(0);
    // The kinds are kept for when the switch comes back on: what is
    // stored is the kinds turned off, none here.
    expect(window.localStorage.getItem("nexttex.editor.hover.hidden")).toBe("");
    applyAppearance({ ...DEFAULTS, hover: false, hoverKinds: { ...DEFAULTS.hoverKinds, refs: false } });
    expect(storedAppearance().hoverKinds.refs).toBe(false);
    expect(storedAppearance().hover).toBe(false);
  });

  it("stores the kinds turned off, drops a name it does not know, and keeps the rest on", () => {
    // What is stored is the kinds turned off, so a kind a later build
    // adds is on for a writer who chose before it existed, which is what
    // every kind is until it is turned off; a name a later build retired,
    // or one a hand edit invented, does not survive into the record.
    applyAppearance({ ...DEFAULTS, hoverKinds: { ...DEFAULTS.hoverKinds, figures: false, cites: false } });
    expect(window.localStorage.getItem("nexttex.editor.hover.hidden")).toBe("figures,cites");
    expect(hoverCardsFrom("maths,banana, tables")).toEqual(new Set(["maths", "tables"]));
    expect(hoverCardsFrom("")).toEqual(new Set());
    expect(hoverCardsFrom(undefined)).toEqual(new Set(HOVER_KINDS));
    window.localStorage.setItem("nexttex.editor.hover.hidden", "figures,nope");
    expect(storedAppearance().hoverKinds).toEqual({
      maths: true, tables: true, figures: false, refs: true, cites: true, files: true,
    });
  });
});

describe("the keymap", () => {
  it("is the default unless vim or emacs was stored", () => {
    window.localStorage.setItem("nexttex.editor.keymap", "vi");
    expect(storedAppearance().keymap).toBe("default");
    window.localStorage.setItem("nexttex.editor.keymap", "emacs");
    expect(storedAppearance().keymap).toBe("emacs");
  });
});
