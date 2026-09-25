import { describe, expect, test } from "vitest";
import { ignoredFrom } from "./after-end";

describe("what TeX never reads", () => {
  // Q-065: three lines typed after \end{document} built cleanly and
  // appeared nowhere, and nothing said why.
  test("text after \\end{document} is found", () => {
    const text = "\\begin{document}\nHi.\n\\end{document}\n\\section{Outlook}\n";
    expect(text.slice(ignoredFrom(text))).toBe("\n\\section{Outlook}\n");
  });
  test("blank space after it is not worth a mark", () => {
    expect(ignoredFrom("\\begin{document}\n\\end{document}\n\n  \n")).toBe(-1);
  });
  test("a commented \\end{document} is not the end", () => {
    const text = "% \\end{document}\n\\begin{document}\nA.\n\\end{document}\nB.";
    expect(text.slice(ignoredFrom(text))).toBe("\nB.");
  });
  test("an escaped percent sign does not comment it out", () => {
    const text = "50\\% done \\end{document}\nafter";
    expect(text.slice(ignoredFrom(text))).toBe("\nafter");
  });
  test("a file with no \\end{document} has nothing ignored", () => {
    expect(ignoredFrom("\\section{Two}\nA chapter.\n")).toBe(-1);
  });
});
