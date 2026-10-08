/** Where each word of a stress document really is in its source.
 *
 *  The truth the census checks against: every word TeX would set from the
 *  body of the document, with its file, line and columns, in reading
 *  order, following `\input`. It is deliberately simple and knows only the
 *  constructs the stress documents use. Command names are not words, the
 *  arguments of keyed commands are not words, and an accent macro is the
 *  letter it sets.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export type Token = { file: string; line: number; col: number; endCol: number; fold: string };

/** A word as the census compares it: no ligature, no accent, lower case. */
export function fold(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/ﬀ/g, "ff").replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .replace(/[̀-ͯ¨´`ˆ˜]/g, "")
    .toLowerCase();
}

const SKIP_ARG = new Set([
  "label", "ref", "eqref", "cite", "begin", "end", "input", "includegraphics",
  "usepackage", "documentclass", "textcolor", "color", "pagestyle",
]);

export function sourceTokens(dir: string, main: string): Token[] {
  const out: Token[] = [];
  let inBody = false;
  const walk = (file: string) => {
    const lines = readFileSync(path.join(dir, file), "utf8").split("\n");
    lines.forEach((raw, index) => {
      if (!inBody) {
        if (raw.includes("\\begin{document}")) inBody = true;
        return;
      }
      const input = /\\input\{([^}]+)\}/.exec(raw);
      if (input) {
        walk(input[1].endsWith(".tex") ? input[1] : `${input[1]}.tex`);
        return;
      }
      let text = raw;
      const comment = text.search(/(?<!\\)%/);
      if (comment >= 0) text = text.slice(0, comment);
      let i = 0;
      let word = "";
      let wordStart = -1;
      const flush = (end: number) => {
        if (word && /\p{L}/u.test(word)) out.push({ file, line: index + 1, col: wordStart, endCol: end, fold: fold(word) });
        word = "";
        wordStart = -1;
      };
      while (i < text.length) {
        const ch = text[i];
        if (ch === "\\") {
          // An accent macro is part of the word it sits in.
          const accent = /^\\(["'`^~])\{?([A-Za-z])\}?/.exec(text.slice(i));
          if (accent) {
            if (wordStart < 0) wordStart = i;
            word += accent[2];
            i += accent[0].length;
            continue;
          }
          flush(i);
          const name = /^\\([A-Za-z]+|.)/.exec(text.slice(i))!;
          i += name[0].length;
          if (SKIP_ARG.has(name[1])) {
            while (text[i] === " ") i += 1;
            if (text[i] === "[") i = text.indexOf("]", i) + 1;
            if (text[i] === "{") {
              let depth = 0;
              for (; i < text.length; i += 1) {
                if (text[i] === "{") depth += 1;
                if (text[i] === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
              }
            }
          }
          continue;
        }
        if (/[\p{L}\p{N}]/u.test(ch)) {
          if (wordStart < 0) wordStart = i;
          word += ch;
          i += 1;
          continue;
        }
        // A brace inside a word, `\textbf{wo}rd`, does not end it.
        if ((ch === "{" || ch === "}") && word && /[\p{L}]/u.test(text[i + 1] ?? "")) { i += 1; continue; }
        flush(i);
        i += 1;
      }
      flush(text.length);
    });
  };
  walk(main);
  return out;
}
