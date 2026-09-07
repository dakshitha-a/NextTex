import { describe, expect, test } from "vitest";
import {
  braceAfter,
  inlineMath,
  commentStart,
  familyOf,
  familyOfEnvironment,
  TITLED,
} from "./latex-families";

describe("which family a command belongs to", () => {
  test.each([
    ["section", "structure"],
    ["chapter", "structure"],
    ["cite", "cite"],
    ["citep", "cite"],
    ["ref", "cite"],
    ["label", "cite"],
    ["usepackage", "preamble"],
    ["newcommand", "preamble"],
    ["begin", "env"],
    ["caption", "env"],
    ["frac", "math"],
    ["alpha", "math"],
    ["Omega", "math"],
  ])("\\%s is %s", (command, family) => {
    expect(familyOf(command)).toBe(family);
  });

  test("a starred command keeps its family", () => {
    expect(familyOf("section*")).toBe("structure");
    expect(familyOf("subsection*")).toBe("structure");
  });

  test("a command nobody named is left alone", () => {
    // The point of the finite lists: a package-specific macro takes the
    // ordinary command styling rather than a colour that would claim it
    // means something it does not.
    expect(familyOf("mycommand")).toBeNull();
    expect(familyOf("ONP")).toBeNull();
    expect(familyOf("textbf")).toBeNull();
  });

  test("a name in two lists takes the first, not the last", () => {
    // \bibliographystyle is listed under both citations and preamble.
    expect(familyOf("bibliographystyle")).toBe("cite");
  });
});

describe("which family an environment belongs to", () => {
  test.each(["equation", "align", "gather", "cases", "pmatrix"])(
    "%s is mathematics",
    (name) => expect(familyOfEnvironment(name)).toBe("math"),
  );
  test.each(["table", "figure", "itemize", "tabular", "abstract"])(
    "%s is an ordinary environment",
    (name) => expect(familyOfEnvironment(name)).toBe("env"),
  );
  test("a starred environment is judged on its bare name", () => {
    expect(familyOfEnvironment("align*")).toBe("math");
    expect(familyOfEnvironment("figure*")).toBe("env");
  });
});

describe("where a comment starts", () => {
  test("an ordinary comment", () => {
    expect(commentStart("text % and a note")).toBe(5);
  });
  test("a line with no comment", () => {
    expect(commentStart("\\section{Results}")).toBe(-1);
  });
  test("an escaped percent is not a comment", () => {
    expect(commentStart("a 50\\% yield")).toBe(-1);
  });
  test("a line break before a percent still ends the line", () => {
    // `\\` is a line break, not an escape, so the % after it is a comment.
    expect(commentStart("a \\\\ % note")).toBe(5);
  });
});

describe("finding the braced argument", () => {
  test("the argument straight after the command", () => {
    const text = "\\section{Results}";
    expect(braceAfter(text, 8)).toEqual({ open: 8, close: 16 });
  });

  test("nested braces are matched, not the first close", () => {
    const text = "\\section{The \\emph{good} bit}";
    const found = braceAfter(text, 8)!;
    expect(text.slice(found.open + 1, found.close)).toBe("The \\emph{good} bit");
  });

  test("an optional argument is stepped over", () => {
    const text = "\\section[Short]{The long one}";
    const found = braceAfter(text, 8)!;
    expect(text.slice(found.open + 1, found.close)).toBe("The long one");
  });

  test("an unclosed brace finds nothing rather than running to the end", () => {
    expect(braceAfter("\\section{Results", 8)).toBeNull();
  });

  test("a command with no argument on the line", () => {
    expect(braceAfter("\\centering", 10)).toBeNull();
  });

  test("an escaped brace does not open or close a group", () => {
    const text = "\\section{a \\} b}";
    const found = braceAfter(text, 8)!;
    expect(text.slice(found.open + 1, found.close)).toBe("a \\} b");
  });
});

test("the commands whose heading is lit are the sectioning ones", () => {
  expect(TITLED.has("section")).toBe(true);
  expect(TITLED.has("chapter")).toBe(true);
  expect(TITLED.has("title")).toBe(true);
  // Not these: they take no heading worth colouring.
  expect(TITLED.has("tableofcontents")).toBe(false);
  expect(TITLED.has("cite")).toBe(false);
});

describe("inline mathematics", () => {
  const spans = (text: string) =>
    inlineMath(text).map((s) => text.slice(s.from, s.to));

  test("a single span", () => {
    expect(spans("the value $S_1$ is small")).toEqual(["$S_1$"]);
  });

  test("two spans on one line", () => {
    expect(spans("$a$ and $b$")).toEqual(["$a$", "$b$"]);
  });

  test("a display span", () => {
    expect(spans("$$E = mc^2$$")).toEqual(["$$E = mc^2$$"]);
  });

  test("a single dollar inside a display does not end it", () => {
    expect(spans("$$a \\text{x} b$$")).toEqual(["$$a \\text{x} b$$"]);
  });

  test("an escaped dollar is a currency sign, not mathematics", () => {
    expect(spans("it cost \\$5 and \\$6")).toEqual([]);
  });

  test("a span left open at the end of the line is dropped", () => {
    // Being wrong about where the mathematics ends is worse than leaving
    // it plain: the rest of the file would take the colour.
    expect(spans("\\[ a = b")).toEqual([]);
    expect(spans("the opening $ of a display")).toEqual([]);
  });

  test("a line with no mathematics", () => {
    expect(spans("\\section{Results}")).toEqual([]);
  });
});

describe("a display written on one line", () => {
  const spans = (text: string) =>
    inlineMath(text).map((s) => text.slice(s.from, s.to));

  test("bracket delimiters", () => {
    expect(spans("before \\[ E = mc^2 \\] after")).toEqual(["\\[ E = mc^2 \\]"]);
  });

  test("a dollar inside a bracket display does not end it", () => {
    expect(spans("\\[ a \\text{$b$} c \\]")).toEqual(["\\[ a \\text{$b$} c \\]"]);
  });

  test("a bracket left open is left alone", () => {
    // The cross-line scan picks that up; guessing here would colour the
    // rest of the line.
    expect(spans("\\[ a = b")).toEqual([]);
  });
});
