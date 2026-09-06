import { describe, expect, it } from "vitest";
import { dismisses } from "./useDismiss";

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
