import { describe, expect, test } from "vitest";
import { DOUBLE_CLICK_MS, headerClick } from "./header-gesture";

describe("headerClick", () => {
  test("a first click arms the fold", () => {
    expect(headerClick(null, null, "editor", 1000)).toEqual({ kind: "arm" });
  });

  test("a second click on the same header inside the window is the mode", () => {
    const pending = { pane: "pdf" as const, at: 1000 };
    expect(headerClick(pending, null, "pdf", 1000 + DOUBLE_CLICK_MS - 1)).toEqual({
      kind: "mode",
    });
  });

  test("a second click after the window is a new single click", () => {
    // The timer will already have folded the pane; the reducer is only
    // asked while a fold is pending, but a stale record must not become a
    // mode change.
    const pending = { pane: "pdf" as const, at: 1000 };
    expect(headerClick(pending, null, "pdf", 1000 + DOUBLE_CLICK_MS)).toEqual({
      kind: "arm",
    });
  });

  test("a click on the other header folds the first and waits on the second", () => {
    const pending = { pane: "editor" as const, at: 1000 };
    expect(headerClick(pending, null, "pdf", 1100)).toEqual({
      kind: "fold-then-arm", fold: "editor",
    });
  });

  test("a click just after a tab was selected is the second half of that double-click", () => {
    // Click one selected the tab; click two lands on a tab that is now in
    // front.  Without this the pane folds under a writer who only meant
    // to switch.
    expect(headerClick(null, 1000, "editor", 1000 + 120)).toEqual({ kind: "ignore" });
    expect(headerClick(null, 1000, "editor", 1000 + DOUBLE_CLICK_MS)).toEqual({
      kind: "arm",
    });
  });

  test("a selection outranks a pending fold on the other header", () => {
    const pending = { pane: "pdf" as const, at: 1000 };
    expect(headerClick(pending, 1050, "editor", 1100)).toEqual({ kind: "ignore" });
  });
});
