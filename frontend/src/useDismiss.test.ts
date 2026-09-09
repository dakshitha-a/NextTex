import { describe, expect, it } from "vitest";
import { dismisses, restores, tabbable, wraps } from "./useDismiss";

/** The bug this guards against shipped three times over: the Usage panel,
 *  the settings card and a file row's menu could each be opened by their
 *  button and then not closed by it.  The press arrives in the capture
 *  phase, before the trigger's own click, so without the anchor the panel
 *  closed here and the trigger reopened it in the same gesture. */
function scene() {
  document.body.innerHTML = "";
  const anchor = document.createElement("button");
  const inAnchor = document.createElement("span");
  anchor.append(inAnchor);
  const panel = document.createElement("div");
  const inPanel = document.createElement("input");
  panel.append(inPanel);
  const elsewhere = document.createElement("p");
  document.body.append(anchor, panel, elsewhere);
  return { anchor, inAnchor, panel, inPanel, elsewhere };
}

describe("dismisses", () => {
  it("closes on a press outside the panel", () => {
    const { panel, anchor, elsewhere } = scene();
    expect(dismisses(panel, anchor, elsewhere)).toBe(true);
  });

  it("leaves a press inside the panel alone", () => {
    const { panel, anchor, inPanel } = scene();
    expect(dismisses(panel, anchor, inPanel)).toBe(false);
  });

  it("leaves the trigger to close what it opened", () => {
    const { panel, anchor } = scene();
    expect(dismisses(panel, anchor, anchor)).toBe(false);
  });

  it("counts a press on something inside the trigger as the trigger", () => {
    const { panel, anchor, inAnchor } = scene();
    expect(dismisses(panel, anchor, inAnchor)).toBe(false);
  });

  it("still closes on the trigger when no anchor was given", () => {
    const { panel, anchor } = scene();
    expect(dismisses(panel, undefined, anchor)).toBe(true);
  });

  it("does nothing before the panel has mounted", () => {
    const { anchor, elsewhere } = scene();
    expect(dismisses(null, anchor, elsewhere)).toBe(false);
  });
});

/** The focus trap. Seven of the nine dialogs let Tab walk out into the page
 *  behind them, and dismissing one left focus on `document.body`, so the next
 *  Tab started from the top of the app rather than from the control that had
 *  opened the dialog. */
function dialog() {
  document.body.innerHTML = "";
  const outside = document.createElement("button");
  outside.textContent = "behind";
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  const first = document.createElement("button");
  const middle = document.createElement("input");
  const last = document.createElement("button");
  panel.append(first, middle, last);
  document.body.append(outside, panel);
  return { outside, panel, first, middle, last };
}

describe("keeping Tab inside a dialog", () => {
  it("finds what Tab would stop at, and nothing else", () => {
    const { panel, first, middle, last } = dialog();
    const skipped = document.createElement("button");
    skipped.disabled = true;
    panel.append(skipped);
    expect(tabbable(panel)).toEqual([first, middle, last]);
  });

  it("sends Tab from the last one back to the first", () => {
    const { first, middle, last } = dialog();
    expect(wraps([first, middle, last], last, false)).toBe(first);
  });

  it("sends Shift Tab from the first one round to the last", () => {
    const { first, middle, last } = dialog();
    expect(wraps([first, middle, last], first, true)).toBe(last);
  });

  it("leaves Tab alone in the middle, which is most presses", () => {
    const { first, middle, last } = dialog();
    expect(wraps([first, middle, last], middle, false)).toBeNull();
    expect(wraps([first, middle, last], middle, true)).toBeNull();
  });

  it("pulls focus back when it has already escaped", () => {
    // Which is the state a dialog opens in: the caret is still on whatever
    // was behind it.
    const { outside, first, middle, last } = dialog();
    expect(wraps([first, middle, last], outside, false)).toBe(first);
    expect(wraps([first, middle, last], outside, true)).toBe(last);
  });

  it("has nothing to say about a dialog with nothing to focus", () => {
    expect(wraps([], null, false)).toBeNull();
  });
});

describe("giving the caret back, but not taking it", () => {
  it("puts it back when the panel still had it", () => {
    const { panel, first } = dialog();
    first.focus();
    expect(restores(panel, document.activeElement)).toBe(true);
  });

  it("puts it back when the focused element has just been unmounted", () => {
    // Which leaves `document.body` holding focus, and is the ordinary case
    // for a dialog dismissed with Escape.
    const { panel } = dialog();
    expect(restores(panel, document.body)).toBe(true);
  });

  it("leaves it alone when the closing gesture handed it to something else", () => {
    // The regression, and a real one: the file tree's Rename item closes its
    // menu and an inline input takes the caret in the same gesture.
    // Restoring on the way out took it straight back off again, and the new
    // name was typed into nothing.
    const { panel, outside } = dialog();
    outside.focus();
    expect(restores(panel, document.activeElement)).toBe(false);
  });
});
