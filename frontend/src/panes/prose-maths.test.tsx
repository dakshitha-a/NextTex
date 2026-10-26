import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { inline } from "./prose";
import { loadKatex, setProjectMacros } from "./katex-load";
import { mount } from "../ui/mount";

/** Maths in a reply and in the Markdown preview.
 *
 *  The thesis's agent explained an equation and the column showed its
 *  source, with every `_` between two dollars taken for italics, so
 *  `\mathbf{f}_{IJ}` lost its underscores and half the paragraph leaned.
 *  These hold that maths is set, and that dollars that are not maths stay
 *  the writer's dollars. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  setProjectMacros({});
});

beforeAll(async () => {
  await loadKatex();
});

function render(text: string): HTMLElement {
  const m = (mounted = mount(<p>{inline(text, "t")}</p>));
  return m.container.querySelector("p")!;
}

const maths = (p: HTMLElement) =>
  [...p.querySelectorAll("[data-maths]")].map((node) => node.getAttribute("data-maths"));

describe("maths in prose", () => {
  test("is set inline and on its own line, and its underscores are subscripts", () => {
    const p = render(
      "Like $\\mathbf{f}_{IJ}$, it collects the velocities $\\dot{\\mathbf{R}}_A$ of all $N$ nuclei:\n"
      + "$$\\sigma_{IJ} = \\dot{\\mathbf{R}}\\cdot\\mathbf{f}_{IJ} = \\sum_A^N \\dot{\\mathbf{R}}_A\\cdot\\mathbf{f}^A_{IJ}.$$",
    );
    expect(maths(p)).toEqual(["inline", "inline", "inline", "display"]);
    expect(p.querySelector("em")).toBeNull();
    expect(p.querySelectorAll(".katex").length).toBe(4);
    expect(p.querySelectorAll(".katex-display").length).toBe(1);
  });

  test("takes the LaTeX delimiters too", () => {
    expect(maths(render("so \\(E = mc^2\\) and \\[ \\int_0^1 x\\,dx \\]"))).toEqual(["inline", "display"]);
  });

  test("leaves prices, escaped dollars and code alone", () => {
    expect(maths(render("between $5 and $10 a page"))).toEqual([]);
    expect(maths(render("a literal \\$ sign and another \\$"))).toEqual([]);
    const p = render("run `echo $HOME$` there");
    expect(maths(p)).toEqual([]);
    expect(p.querySelector("code")?.textContent).toBe("echo $HOME$");
  });

  test("is set inside bold and italic", () => {
    const p = render("**the coupling $\\sigma_{IJ}$** and *the force $F$*");
    expect(p.querySelector("strong [data-maths]")).not.toBeNull();
    expect(p.querySelector("em [data-maths]")).not.toBeNull();
  });

  test("uses the project's macros, and shows what it cannot parse as its source", () => {
    setProjectMacros({ "\\npistar": "n\\pi^{*}" });
    expect(maths(render("the $\\npistar$ state"))).toEqual(["inline"]);
    const broken = render("a $\\frac{1}{$ typo");
    expect(maths(broken)).toEqual(["source"]);
    expect(broken.textContent).toContain("$\\frac{1}{$");
  });
});
