import { describe, expect, it } from "vitest";
import { addEndOfContent, cleanCopy } from "./pdf-select";

describe("cleanCopy", () => {
  it("puts an accent set as its own glyph back on its letter", () => {
    expect(cleanCopy("Schr¨odinger and the caf´e")).toBe("Schrödinger and the café");
    expect(cleanCopy("na¨ıve")).toBe("naïve");
  });

  it("joins a word TeX broke at a line end", () => {
    expect(cleanCopy("long misrep-\nresentations here")).toBe("long misrepresentations here");
  });

  it("keeps a hyphen before a capital, and every other line break", () => {
    expect(cleanCopy("Smith-\nJones")).toBe("Smith-\nJones");
    expect(cleanCopy("one line\nthe next")).toBe("one line\nthe next");
  });

  it("leaves text with nothing to mend as it was", () => {
    expect(cleanCopy("Efficient office staff")).toBe("Efficient office staff");
  });
});

describe("addEndOfContent", () => {
  it("puts the element last in the layer", () => {
    const layer = document.createElement("div");
    layer.innerHTML = "<span>a</span><span>b</span>";
    addEndOfContent(layer);
    expect(layer.lastElementChild?.className).toBe("endOfContent");
  });
});
