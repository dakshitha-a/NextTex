import { describe, expect, test } from "vitest";
import { ignoreKey, proseOf } from "./grammar";

describe("the prose Harper is given", () => {
  test("is the document's own lines, commands and maths blanked at their offsets", () => {
    const lines = ["See \\cite{knuth} and $x^2$ here.", "\\begin{equation}", "E = mc^2", "\\end{equation}"];
    const prose = proseOf(lines, new Set([2, 3, 4]), 1);
    expect(prose.length).toBe(lines.join("\n").length);
    expect(prose.split("\n")[0].replace(/ +/g, " ")).toBe("See and here.");
    expect(prose.split("\n")[2].trim()).toBe("");
  });
});

describe("a finding's key for ignoring it in the project", () => {
  test("is evened out the way the project's store evens it", () => {
    expect(ignoreKey({ kind: "Repetition", text: "That  that" })).toBe("repetition: that that");
  });
});
