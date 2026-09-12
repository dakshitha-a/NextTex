import type { Symbols } from "../api";

/** The cross references a LaTeX writer clicks on, and where they go.
 *
 *  A thesis is a graph held together by `\ref`, `\input` and `\cite`, and
 *  none of the three went anywhere: finding what `\ref{eq:flux}` points at
 *  meant remembering which chapter held the equation and searching it for
 *  the label. The project's symbol table has known where every label,
 *  every `.tex` and every bibliography entry lives since the completion
 *  list was built on it, and nothing but the completion list read it.
 */

export type LinkKind = "ref" | "input" | "cite";

export type Link = {
  kind: LinkKind;
  /** The label, the file or the citation key, with nothing around it. */
  name: string;
  /** Where that name sits in the line, so it can be marked. */
  from: number;
  to: number;
};

/** The command families, spelled out rather than matched by prefix.
 *
 *  `\citation` is not a citation command and `\reflectbox` is not a
 *  reference, and both would match a prefix rule. Starred forms are taken
 *  by the pattern below rather than being listed twice.
 */
const REFS = new Set([
  "ref", "eqref", "autoref", "cref", "Cref", "cpageref", "Cpageref",
  "pageref", "nameref", "vref", "labelcref",
]);
const INPUTS = new Set(["input", "include", "subfile", "subfileinclude"]);
const CITES = new Set([
  "cite", "citep", "citet", "citealt", "citealp", "citeauthor", "citeyear",
  "citeyearpar", "parencite", "textcite", "autocite", "footcite", "smartcite",
  "supercite", "fullcite", "citetitle",
]);

/** `\cmd*[optional]{a,b}`. The optional argument is what `\cite[p. 3]{a}`
 *  puts between the command and its keys. */
const CALL = /\\([A-Za-z]+)\*?\s*(?:\[[^\]\n]*\]\s*)*\{([^}\n]*)\}/g;

function kindOf(command: string): LinkKind | null {
  if (REFS.has(command)) return "ref";
  if (INPUTS.has(command)) return "input";
  if (CITES.has(command)) return "cite";
  return null;
}

/** The link under a column, or null. `column` is a 0-based offset.
 *
 *  A click anywhere in the call counts, the command name included, because
 *  the braces are four characters wide and asking somebody to hit them is
 *  asking them to miss. With several keys in one `\cite`, the key under
 *  the pointer is the one that answers, so `\cite{a,b}` sends you to
 *  whichever of the two you pointed at.
 */
export function linkAt(line: string, column: number): Link | null {
  CALL.lastIndex = 0;
  for (let found = CALL.exec(line); found; found = CALL.exec(line)) {
    const start = found.index;
    const end = start + found[0].length;
    if (column < start || column > end) continue;
    const kind = kindOf(found[1]);
    if (!kind) return null;
    const inside = found[2];
    const at = end - 1 - inside.length;
    if (!inside.trim()) return null;
    // Split on commas, keeping each piece's offset, so the one under the
    // pointer can be picked out and marked where it actually is.
    let cursor = 0;
    for (const piece of inside.split(",")) {
      const from = at + cursor;
      cursor += piece.length + 1;
      const name = piece.trim();
      if (!name) continue;
      const nameFrom = from + piece.indexOf(name);
      // The last piece also answers for a click on the closing brace or
      // on the command name, which is why this is not a strict test.
      if (column <= nameFrom + name.length || cursor >= inside.length) {
        return { kind, name, from: nameFrom, to: nameFrom + name.length };
      }
    }
    return null;
  }
  return null;
}

/** Where a `\ref` goes: the file and line its `\label` is on. */
export function labelTarget(
  name: string, symbols: Symbols | null,
): { file: string; line: number } | null {
  const found = symbols?.labels.find((label) => label.name === name);
  return found ? { file: found.file, line: found.line } : null;
}

/** Which file a `\input{chapters/one}` means.
 *
 *  LaTeX lets the suffix be left off and almost everybody does, so the
 *  name is tried as written and then with `.tex` on the end, against the
 *  list of `.tex` files the symbol walk already collected.
 */
export function inputTarget(name: string, symbols: Symbols | null): string | null {
  const files = symbols?.texfiles ?? [];
  const clean = name.replace(/^\.\//, "");
  for (const candidate of [clean, `${clean}.tex`]) {
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

/** The bibliography entry a `\cite` key names. */
export function citationFor(key: string, symbols: Symbols | null) {
  return symbols?.citations.find((entry) => entry.key === key) ?? null;
}
