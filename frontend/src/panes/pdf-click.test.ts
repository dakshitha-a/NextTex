import { describe, expect, it } from "vitest";
import { textAtPoint, wordAt } from "./pdf-click";

describe("wordAt", () => {
  it("takes the word under the pointer and the text either side", () => {
    expect(wordAt(["The model predicts", " ", "the state"], 0, 6)).toEqual({
      word: "model",
      before: "The ",
      after: " predicts the state",
    });
  });

  it("joins spans pdf.js split inside a word: maths, an accent, a macro", () => {
    // `$S_0$` is an "S" span and a "0" span; an accent without its own
    // glyph is a span of its own; `\textbf{wo}rd` is two spans.
    expect(wordAt(["state ", "S", "0", " and"], 1, 0).word).toBe("S0");
    expect(wordAt(["Schr¨", "odinger wrote"], 1, 2).word).toBe("Schr¨odinger");
    expect(wordAt(["a ", "wo", "rd split"], 2, 1).word).toBe("word");
  });

  it("rejoins a word hyphenated across a line", () => {
    expect(wordAt(["some misrep-", "\n", "resentations here"], 2, 3).word).toBe("misrep-\nresentations");
    expect(wordAt(["some misrep-", "\n", "resentations here"], 0, 7).word).toBe("misrep-\nresentations");
    // A dash at the end of a line before a capital is a dash.
    expect(wordAt(["Smith-", "\n", "Jones"], 2, 1).word).toBe("Jones");
  });

  it("keeps a number with its point", () => {
    expect(wordAt(["mass 12.5 g"], 0, 6).word).toBe("12.5");
    expect(wordAt(["end. Then"], 0, 2).word).toBe("end");
  });

  it("takes a pointer just past a word's end as on the word", () => {
    expect(wordAt(["word, next"], 0, 4).word).toBe("word");
  });

  it("has no word on a space or a symbol, and keeps the neighbours", () => {
    const hint = wordAt(["E = mc"], 0, 2);
    expect(hint.word).toBe("");
    expect(hint.before).toBe("E ");
    expect(hint.after).toBe("= mc");
  });
});

describe("textAtPoint", () => {
  it("reads the layer's spans and line breaks in order", () => {
    const layer = document.createElement("div");
    layer.className = "nx-text-layer";
    layer.innerHTML = "<span>The model</span><br><span>predicts it</span>";
    document.body.appendChild(layer);
    const span = layer.querySelectorAll("span")[1];
    // jsdom lays nothing out, so every character measures the same and the
    // first is nearest: the point is in "predicts".
    const hint = textAtPoint(layer, span, 0, 0)!;
    expect(hint.word).toBe("predicts");
    expect(hint.before).toBe("The model\n");
    layer.remove();
  });

  it("knows nothing about a point outside the layer's spans", () => {
    const layer = document.createElement("div");
    layer.innerHTML = "<span>text</span>";
    expect(textAtPoint(layer, layer, 0, 0)).toBeNull();
  });
});
