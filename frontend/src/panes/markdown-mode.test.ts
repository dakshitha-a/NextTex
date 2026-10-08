import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownMode, type MarkdownState } from "./markdown-mode";
import { isTeXFamily } from "./file-kinds";

/** Each line's tokens as [text, style] pairs, prose runs joined. */
function tokens(source: string): Array<Array<[string, string | null]>> {
  const state: MarkdownState = markdownMode.startState();
  return source.split("\n").map((line) => {
    const stream = new StringStream(line, 2, 2);
    const out: Array<[string, string | null]> = [];
    while (!stream.eol()) {
      const style = markdownMode.token(stream, state);
      const text = stream.current();
      const last = out[out.length - 1];
      if (last && last[1] === null && style === null) last[0] += text;
      else out.push([text, style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

describe("the editor's Markdown", () => {
  it("leaves a percent sign and a dollar sign in the prose", () => {
    // The line LaTeX's mode greyed from the `%` on and set as maths.
    expect(tokens("Costs rose 50% to $12 and $15.")).toEqual([
      [["Costs rose 50% to $12 and $15.", null]],
    ]);
  });

  it("reads a heading, emphasis, strong and inline code", () => {
    const [heading, body] = tokens("## Results\nIt is *very* **much** `faster`.");
    expect(heading).toEqual([["## Results", "heading"]]);
    expect(body).toEqual([
      ["It is ", null], ["*very*", "emphasis"], [" ", null], ["**much**", "strong"],
      [" ", null], ["`faster`", "monospace"], [".", null],
    ]);
  });

  it("keeps an underscore inside a name", () => {
    expect(tokens("Run plot_fit.py on data_2026.csv, _then_ look.")).toEqual([[
      ["Run plot_fit.py on data_2026.csv, ", null], ["_then_", "emphasis"], [" look.", null],
    ]]);
  });

  it("holds a fence until its own closing fence", () => {
    const lines = tokens("```python\n# not a heading\n``\n```\n# a heading");
    expect(lines.map((line) => line.map(([, style]) => style))).toEqual([
      ["meta"], ["monospace"], ["monospace"], ["meta"], ["heading"],
    ]);
  });

  it("marks list and quote markers, links and comments", () => {
    const [item, quote, link, comment, rest] = tokens(
      "- [x] done\n> said\nSee [the guide](docs/guide.md).\n<!-- a note\nstill -->after",
    );
    expect(item[0]).toEqual(["- [x] ", "meta"]);
    expect(quote[0]).toEqual(["> ", "meta"]);
    expect(link[1]).toEqual(["[the guide](docs/guide.md)", "link"]);
    expect(comment).toEqual([["<!-- a note", "comment"]]);
    expect(rest).toEqual([["still -->", "comment"], ["after", null]]);
  });

  it("is the language of Markdown only, and LaTeX's mode of the TeX files", () => {
    expect(markdownMode.name).toBe("markdown");
    for (const path of ["main.tex", "refs.bib", "a.sty", "a.cls", "main.bbl"]) {
      expect(isTeXFamily(path)).toBe(true);
    }
    for (const path of ["notes.md", "notes.markdown", "todo.txt", "README"]) {
      expect(isTeXFamily(path)).toBe(false);
    }
  });
});
