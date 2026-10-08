/** The editor's Markdown, read the way the Markdown pane reads it.
 *
 *  A `.md` was drawn in LaTeX's mode until 8 October 2026, by falling
 *  through to it rather than by choice: every `%` began a comment that
 *  greyed the rest of the line, every `$` began maths, a `\section` in a
 *  note folded, and completion offered LaTeX commands to a file that has
 *  none.  This is the structure a Markdown writer looks for and nothing
 *  more: headings, fences and inline code, emphasis, links, the markers
 *  of lists and quotes, rules and HTML comments.  It is a stream mode, as
 *  the editor's other languages are, and small enough to sit in the
 *  editor's own chunk, since `@codemirror/lang-markdown` would bring an
 *  HTML, CSS and JavaScript grammar with it.
 *
 *  No imports, so the vitest beside it drives it with a bare stream. */

export type MarkdownState = {
  /** Inside a fenced block, and the fence that closes it. */
  fence: string | null;
  /** Inside an HTML comment that runs past the end of a line. */
  comment: boolean;
};

/** The part of CodeMirror's `StringStream` this mode uses. */
type Stream = {
  string: string;
  pos: number;
  sol(): boolean;
  eol(): boolean;
  match(pattern: RegExp | string, consume?: boolean): unknown;
  next(): string | void;
  peek(): string | undefined;
  skipToEnd(): void;
  eatWhile(match: RegExp): boolean;
  skipTo(text: string): boolean | void;
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;

/** A run of ordinary prose, stopped before anything that could open a
 *  span. */
const PLAIN = /[^`*_\[<!\\]/;

function closingComment(stream: Stream, state: MarkdownState): string {
  if (stream.skipTo("-->")) {
    stream.match("-->");
    state.comment = false;
  } else {
    stream.skipToEnd();
    state.comment = true;
  }
  return "comment";
}

export const markdownMode = {
  name: "markdown",
  startState: (): MarkdownState => ({ fence: null, comment: false }),
  copyState: (state: MarkdownState): MarkdownState => ({ ...state }),

  token(stream: Stream, state: MarkdownState): string | null {
    if (state.comment) return closingComment(stream, state);

    if (state.fence !== null) {
      // The closing fence is at least as long as the opening one and of
      // the same character, and everything up to it is the block's text.
      const close = stream.sol() && stream.match(FENCE, false);
      const run = close ? /^\s*(`+|~+)/.exec(stream.string)?.[1] ?? "" : "";
      if (close && run[0] === state.fence[0] && run.length >= state.fence.length
          && stream.string.trim() === run) {
        stream.skipToEnd();
        state.fence = null;
        return "meta";
      }
      stream.skipToEnd();
      return "monospace";
    }

    if (stream.sol()) {
      const fence = stream.match(FENCE) as RegExpMatchArray | null;
      if (fence) {
        state.fence = fence[1];
        stream.skipToEnd();
        return "meta";
      }
      if (stream.match(HEADING, false)) {
        stream.skipToEnd();
        return "heading";
      }
      if (stream.match(RULE)) return "contentSeparator";
      if (stream.match(QUOTE)) return "meta";
      if (stream.match(ITEM)) return "meta";
    }

    if (stream.match("<!--")) return closingComment(stream, state);

    // A backslash escapes the next character, which is then prose.
    if (stream.match(/^\\./)) return null;

    const code = stream.match(/^(`+)/) as RegExpMatchArray | null;
    if (code) {
      if (stream.skipTo(code[1])) stream.match(code[1]);
      else stream.skipToEnd();
      return "monospace";
    }

    if (stream.match(/^(\*\*|__)(?=\S)(.+?\S)\1/)) return "strong";
    // An underscore inside a word is part of it: `snake_case` and
    // `file_name.md` are names, not emphasis.
    const before = stream.string[stream.pos - 1] ?? "";
    if (stream.match(/^\*(?=\S)([^*]*?\S)\*/)) return "emphasis";
    if (!/\w/.test(before) && stream.match(/^_(?=\S)([^_]*?\S)_(?!\w)/)) return "emphasis";

    if (stream.match(/^!?\[[^\]\n]*\](\([^)\n]*\)|\[[^\]\n]*\])/)) return "link";
    if (stream.match(/^<(https?:|mailto:)[^>\s]+>/)) return "url";

    stream.next();
    stream.eatWhile(PLAIN);
    return null;
  },

  languageData: {
    commentTokens: { block: { open: "<!--", close: "-->" } },
    // `$` is a dollar sign here, and `'` an apostrophe.
    closeBrackets: { brackets: ["(", "[", "{", '"', "`"] },
  },
};
