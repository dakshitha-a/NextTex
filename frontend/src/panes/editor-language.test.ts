/**
 * @vitest-environment jsdom
 */
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { describe, expect, test, vi } from "vitest";

import { freshState, languageFor } from "./editor-setup";

/** The names of the syntax nodes a buffer parses into, which for a stream
 *  language are its token types. */
function tokens(path: string, text: string): string[] {
  const view = new EditorView({
    state: freshState(text, [], languageFor(path, () => null)),
  });
  const tree = ensureSyntaxTree(view.state, text.length, 1000);
  const found: string[] = [];
  tree?.iterate({ enter: (node) => { found.push(node.name); } });
  view.destroy();
  return found;
}

describe("which language a buffer speaks", () => {
  test("a script is Python, so `def` is a keyword and `#` a comment", () => {
    // Without this the figure scripts the agent writes opened as LaTeX,
    // where `def` is prose and `\section` is the only thing with weight.
    const names = tokens("scripts/fig.py", "def f():\n    return 1  # one\n");
    expect(names).toContain("keyword");
    expect(names).toContain("comment");
  });

  test("a chapter is still LaTeX", () => {
    const names = tokens("chapters/one.tex", "\\section{One}\n% note\n");
    expect(names).toContain("comment");
    expect(names).not.toContain("keyword");
  });

  test("a style sheet is not a script", () => {
    // `.mplstyle` is text the writer may edit, and nothing to run.
    const names = tokens("scripts/plotstyle.mplstyle", "font.size: 9\n");
    expect(names).not.toContain("keyword");
  });
});

/** The colour mode for a script is five CSS variables that styles.css fills
 *  under `.nx-syntax-colour`, so the names the HighlightStyle asks for and
 *  the names the stylesheet sets have to agree.  This pins the style's
 *  half: the rule the highlighter generates for a keyword reads
 *  `--nx-py-keyword`, and the one for a string reads `--nx-py-string`. */
function ruleFor(text: string, source: string): string {
  const view = new EditorView({
    parent: document.body,
    state: freshState(source, [], languageFor("scripts/fig.py", () => null)),
  });
  ensureSyntaxTree(view.state, source.length, 1000);
  view.requestMeasure();
  const span = [...view.contentDOM.querySelectorAll("span")]
    .find((el) => el.textContent === text && el.children.length === 0);
  const classes = span ? [...span.classList] : [];
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  view.destroy();
  return classes.map((c) => css.split("}").find((rule) => rule.includes(`.${c}`)) ?? "").join("\n");
}

describe("what a script's tokens are styled with", () => {
  const warned = vi.spyOn(console, "warn");

  test("a keyword reads the keyword variable, a string the string one", () => {
    expect(ruleFor("def", 'def f():\n    return "s"\n')).toContain("--nx-py-keyword");
    expect(ruleFor('"s"', 'def f():\n    return "s"\n')).toContain("--nx-py-string");
    expect(ruleFor("f", 'def f():\n    return "s"\n')).toContain("--nx-py-name");
  });

  test("`self` is a token the highlighter knows, so nothing warns", () => {
    // The legacy mode names `self` as a type of its own, which is not a
    // tag `@lezer/highlight` has; without the table in editor-setup.ts
    // the console said "Unknown highlighting tag self" once per page.
    ruleFor("self", "class A:\n    def f(self):\n        return self\n");
    expect(warned).not.toHaveBeenCalledWith(expect.stringContaining("Unknown highlighting tag"));
  });
});
