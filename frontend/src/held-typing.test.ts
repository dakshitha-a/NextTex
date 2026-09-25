import { describe, expect, it } from "vitest";

import { holdTyping } from "./held-typing";

describe("typing held for a box that is on its way", () => {
  it("keeps the letters away from the page and gives them back", () => {
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    const held = holdTyping();
    expect(document.activeElement).not.toBe(input);
    for (const key of ["f", "l", "x", "Backspace", "u"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(held.stop()).toBe("flu");
    // After it stops, keys go where they always did.
    const after = new KeyboardEvent("keydown", { key: "z", cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    input.remove();
  });

  it("leaves chords alone", () => {
    const held = holdTyping();
    const chord = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    window.dispatchEvent(chord);
    expect(chord.defaultPrevented).toBe(false);
    expect(held.stop()).toBe("");
  });
});
