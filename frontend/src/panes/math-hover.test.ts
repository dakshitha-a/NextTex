import { describe, expect, test } from "vitest";
import { mathAt, macrosFrom, prepare } from "./math-hover";

/** Finding the maths under the pointer.
 *
 *  Every one of these is silent when it is wrong: the tooltip simply does
 *  not appear, or appears over prose.  The unbalanced-dollar case is the
 *  one that matters most, because an unclosed `$` is the commonest LaTeX
 *  typo there is and it used to invert the pairing for the whole file.
 */

const body = (text: string, pos: number) => mathAt(text, pos)?.body ?? null;

describe("inline maths", () => {
  test("the cursor inside dollars finds the maths between them", () => {
    // The body is what KaTeX is given, so the delimiters are not in it.
    expect(body("the gap $\\Delta E$ between", 12)).toBe("\\Delta E");
  });

  test("the cursor in the prose beside them finds nothing", () => {
    expect(body("the gap $\\Delta E$ between", 3)).toBeNull();
  });

  test("the opening dollar is outside the span it opens", () => {
    // Which is what stops a tooltip appearing as the pointer crosses into
    // a paragraph from the left.  The closing one is inside, because by
    // then the pointer is already over the maths.
    expect(body("a $x$ b", 2)).toBeNull();
    expect(body("a $x$ b", 3)).toBe("x");
    expect(body("a $x$ b", 5)).toBeNull();
  });

  test("an escaped dollar does not open anything", () => {
    expect(body("it cost \\$5 and \\$6 then", 12)).toBeNull();
  });

  test("display dollars win over two empty inline ones", () => {
    expect(body("see $$x = 1$$ here", 7)).toBe("x = 1");
  });

  test("an unbalanced dollar leaves the paragraph alone", () => {
    expect(body("one $ unclosed and then some more prose", 20)).toBeNull();
  });

  test("a dollar in one paragraph never pairs with one in the next", () => {
    const text = "first $ paragraph\n\nsecond $ paragraph";
    expect(body(text, 10)).toBeNull();
  });
});

describe("bracket and environment maths", () => {
  test("\\[ ... \\] is found", () => {
    expect(body("before \\[x = 1\\] after", 11)).toBe("x = 1");
  });

  test("\\( ... \\) is found", () => {
    expect(body("before \\(x\\) after", 10)).toBe("x");
  });

  test("an equation environment is found whole", () => {
    const text = "\\begin{equation}\n  E = mc^2\n\\end{equation}";
    expect(body(text, 20)).toBe(text);
  });

  test("an align environment is found whole", () => {
    const text = "\\begin{align}\n  a &= b\n\\end{align}";
    expect(body(text, 18)).toBe(text);
  });
});

describe("offsets", () => {
  test("the span is measured from the start of the file, not the paragraph", () => {
    const text = "first paragraph\n\nthe gap $\\Delta E$ here";
    const span = mathAt(text, 30)!;
    expect(text.slice(span.from, span.to)).toBe("$\\Delta E$");
  });
});

describe("what is handed to KaTeX", () => {
  test("a label is taken out, because KaTeX refuses one", () => {
    // Every numbered equation in a thesis carries one, so without this
    // nothing with a number ever previewed at all.
    expect(prepare("E = mc^2 \\label{eq:one}")).not.toContain("\\label");
  });

  test("nonumber and notag go too", () => {
    expect(prepare("a = b \\nonumber \\notag")).toBe("a = b");
  });

  test("an equation environment is unwrapped, an align is not", () => {
    expect(prepare("\\begin{equation}x\\end{equation}")).toBe("x");
    expect(prepare("\\begin{align}x\\end{align}")).toContain("\\begin{align}");
  });

  test("a comment is not rendered", () => {
    expect(prepare("x = 1 % why")).toBe("x = 1");
  });
});

describe("the project's own notation", () => {
  test("a \\newcommand with a body becomes a macro", () => {
    const macros = macrosFrom({
      labels: [], citations: [], images: [], texfiles: [],
      environments: [],
      commands: [{ name: "npistar", args: 0, file: "macros.tex",
                   definition: "n\\pi^*" }],
    } as any);
    expect(macros["\\npistar"]).toBe("n\\pi^*");
  });

  test("a command nobody defined a body for is skipped", () => {
    const macros = macrosFrom({
      labels: [], citations: [], images: [], texfiles: [], environments: [],
      commands: [{ name: "mystery", args: 0, file: "x.tex" }],
    } as any);
    expect(macros["\\mystery"]).toBeUndefined();
  });

  test("no symbols at all is not an error", () => {
    expect(() => macrosFrom(null)).not.toThrow();
  });
});
