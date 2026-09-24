// Grammar and style, locally: Harper, compiled to WebAssembly, over the
// prose alone.
//
// A chunk of its own, and its 16 MB of WebAssembly a file of its own that
// the browser fetches the first time grammar is switched on, so a writer
// who never turns it on pays nothing. It runs over the same prose mask
// spelling does (`proseLine` in `spell-scan.ts`), so a `\cite` is a stretch
// of spaces rather than a sentence with no verb, and a finding's offsets
// are the document's own. English only: Harper has no other language.

import { LocalLinter, type Lint } from "harper.js";
import { binary } from "harper.js/binary";
import { proseLine, skippedLines } from "./spell-scan";

export type Finding = {
  from: number;
  to: number;
  /** Harper's sentence for it: what is wrong, and often why. */
  message: string;
  replacements: string[];
  /** The rule's kind, and the words it found, which together are what
   *  "ignore in this project" remembers. */
  kind: string;
  text: string;
};

/** Rules that are wrong for LaTeX or already somebody else's job: the
 *  mask leaves runs of spaces where commands were, a sentence may start
 *  after a command, dashes are typed as `--` and `---`, spelling has its
 *  own checker, and the serial comma and long sentences are the writer's
 *  style to choose. */
export const RULES_OFF = [
  "Spaces", "SpellCheck", "SentenceCapitalization", "LongSentences", "Dashes",
  "NumericRangeEnDash", "OxfordComma", "NoOxfordComma", "SpelledNumbers", "TransposedSpace",
  "NoFrenchSpaces", "Misspell",
];

let linter: Promise<LocalLinter> | null = null;

function ready(): Promise<LocalLinter> {
  linter ??= (async () => {
    const made = new LocalLinter({ binary });
    await made.setup();
    const config = await made.getLintConfig();
    for (const rule of RULES_OFF) if (rule in config) config[rule] = false;
    await made.setLintConfig(config);
    return made;
  })();
  linter.catch(() => {
    linter = null;
  });
  return linter;
}

/** The prose of a run of lines, as one string with the document's own
 *  line breaks, so a finding's offset into it is the offset from the run's
 *  first character. A line inside a displayed equation or a listing is
 *  blank. */
export function proseOf(lines: readonly string[], skip: ReadonlySet<number>, first: number): string {
  return lines.map((line, index) => (skip.has(first + index) ? " ".repeat(line.length) : proseLine(line))).join("\n");
}

/** A key for "ignore in this project": the rule and the words, in lower
 *  case with their spacing evened, so the same slip anywhere in the project
 *  is ignored and a different one is not. */
export function ignoreKey(finding: Pick<Finding, "kind" | "text">): string {
  // Evened out exactly as the server's store evens it, so the key read
  // back from the project matches the finding it was made from.
  return `${finding.kind}: ${finding.text}`.replace(/\s+/g, " ").trim().toLowerCase();
}

function toFinding(lint: Lint, text: string, base: number): Finding {
  const span = lint.span();
  return {
    from: base + span.start,
    to: base + span.end,
    message: lint.message(),
    replacements: lint.suggestions().map((s) => s.get_replacement_text()).filter(Boolean).slice(0, 4),
    kind: lint.lint_kind(),
    text: text.slice(span.start, span.end),
  };
}

/** Findings in a stretch of the document starting at `base`, less the
 *  ones this project ignores. */
export async function check(
  prose: string, base: number, ignored: ReadonlySet<string>,
): Promise<Finding[]> {
  if (!prose.trim()) return [];
  const made = await ready();
  const lints = await made.lint(prose);
  return lints
    .map((lint) => toFinding(lint, prose, base))
    .filter((finding) => finding.to > finding.from && !ignored.has(ignoreKey(finding)));
}

export { skippedLines };
