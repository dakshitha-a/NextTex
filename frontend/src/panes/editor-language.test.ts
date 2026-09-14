/**
 * @vitest-environment jsdom
 */
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { describe, expect, test } from "vitest";

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
