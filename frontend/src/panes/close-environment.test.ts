import { describe, expect, it } from "vitest";
import { environmentToClose, indentOf } from "./close-environment";

describe("environmentToClose", () => {
  it("closes an environment that has just been opened", () => {
    expect(environmentToClose("\\begin{figure}", "\\begin{figure}\n")).toBe("figure");
  });

  it("leaves an environment that is already closed alone", () => {
    // A writer moving back into a block they wrote earlier. A second
    // \end{figure} there breaks the document they are editing rather than
    // finishing the one they are writing.
    const whole = "\\begin{figure}\n  \\centering\n\\end{figure}\n";
    expect(environmentToClose("\\begin{figure}", whole)).toBeNull();
  });

  it("closes the inner one of a nested pair", () => {
    // Two itemize blocks one inside the other need two \end{itemize}, so
    // this counts rather than looking for the first one it can find.
    const whole =
      "\\begin{itemize}\n  \\item a\n  \\begin{itemize}\n\\end{itemize}\n";
    expect(environmentToClose("  \\begin{itemize}", whole)).toBe("itemize");
  });

  it("says nothing about a line that is not a begin", () => {
    expect(environmentToClose("The results are clear.", "")).toBeNull();
    expect(environmentToClose("\\end{figure}", "\\end{figure}")).toBeNull();
  });

  it("takes an environment with a star, whose name is a regular expression", () => {
    expect(environmentToClose("\\begin{align*}", "\\begin{align*}\n")).toBe("align*");
  });

  it("ignores a begin whose name is not one", () => {
    expect(environmentToClose("\\begin{fig\\ure}", "\\begin{fig\\ure}")).toBeNull();
  });

  it("takes the indentation from the line that opened the block", () => {
    expect(indentOf("    \\begin{itemize}")).toBe("    ");
    expect(indentOf("\\begin{itemize}")).toBe("");
  });
});
