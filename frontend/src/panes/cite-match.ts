/** Which citation keys to offer inside `\cite{...}`, in what order, and
 *  what to put in the text when one is taken.
 *
 *  Pure, so it can be asked without an editor: the completion source in
 *  `latex-complete.ts` is a thin wrapper over it.
 *
 *  Three things a key alone could not do.  A list of citations is a list,
 *  so after each comma the next key is completed on its own, and the keys
 *  already in the braces are not offered again.  A writer remembers a
 *  paper by who wrote it, when, or a word of its title more often than by
 *  the key they gave it, so all four are matched.  And a project with a
 *  bibliography per document offers the one the document in front reads,
 *  not every `.bib` on disk.
 */

import type { Symbols } from "../api";

export type Citation = Symbols["citations"][number];

/** What the editor knows about where it is: the file, which documents
 *  read which files, and which documents are on the strip. */
export type CiteScope = {
  path: string;
  owners: Record<string, string[]>;
  previews: string[];
  activePreview: string;
};

/** The document a file belongs to: the one in front when it reads the
 *  file, else the first that does, else the file itself when it is a
 *  document, else the one in front. */
export function documentOf(
  path: string,
  owners: Record<string, string[]>,
  previews: string[],
  activePreview: string,
): string {
  const readers = owners[path];
  if (readers?.length) return readers.includes(activePreview) ? activePreview : readers[0];
  if (previews.includes(path)) return path;
  return activePreview;
}

/** The entries of the bibliographies `document` reads, one per key; every
 *  entry when it reads none, or when nothing says what it reads, since an
 *  empty list is worse than a long one. */
export function citationScope(
  citations: Citation[],
  owners: Record<string, string[]>,
  document: string,
): Citation[] {
  const seen = new Set<string>();
  const scoped = citations.filter((entry) => {
    if (!entry.file || !document || !owners[entry.file]?.includes(document)) return false;
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
  return scoped.length ? scoped : citations;
}

/** Where the key being typed is, inside the braces, and what is already
 *  there.  `typed` is the argument from the brace to the caret; `after` is
 *  the rest of the line. */
export function citeContext(typed: string, after: string) {
  const comma = typed.lastIndexOf(",");
  const raw = typed.slice(comma + 1);
  const segment = raw.trimStart();
  // The rest of a key the caret is inside, which taking a completion
  // replaces rather than leaves dangling after it. Only inside an argument
  // that closes after it: in `meet~\cite{Tul` typed before a full stop,
  // the stop is the sentence's, not the key's, and taking Tully1990 had
  // swallowed it, since a key may hold a full stop.
  const reach = /^[^,}{\s]*/.exec(after)![0];
  const rest = /^\s*[,}]/.test(after.slice(reach.length)) ? reach : "";
  const close = after.indexOf("}");
  const tail = close >= 0 ? after.slice(rest.length, close) : "";
  const excluded = new Set(
    [...typed.slice(0, comma + 1).split(","), ...tail.split(",")]
      .map((key) => key.trim())
      .filter(Boolean),
  );
  return { segment, back: segment.length, forward: rest.length, excluded };
}

/** Lower case with accents taken off, one character for one, so a range
 *  found in the folded text is the same range in the original. */
export function fold(text: string): string {
  return text
    .split("")
    .map((ch) => (ch.normalize("NFD")[0] ?? ch).toLowerCase())
    .join("");
}

type Entry = {
  citation: Citation;
  index: number;
  key: string;
  surnames: string[];
  year: string;
  title: string;
  /** Where each title word starts. */
  words: number[];
  /** What the detail column says before anything is matched. */
  base: string;
};

let memo: { citations: Citation[]; owners: unknown; document: string; entries: Entry[] } | null = null;

/** The folded haystack for a scope, kept while the symbols, the owners and
 *  the document are the same objects, so a keystroke folds nothing. */
export function haystack(
  citations: Citation[],
  owners: Record<string, string[]>,
  document: string,
): Entry[] {
  if (memo && memo.citations === citations && memo.owners === owners && memo.document === document) {
    return memo.entries;
  }
  const entries = citationScope(citations, owners, document).map((citation, index) => {
    const title = fold(citation.title ?? "");
    const words: number[] = [];
    const word = /[a-z0-9]+/g;
    for (let match = word.exec(title); match; match = word.exec(title)) words.push(match.index);
    const who = citation.authors || citation.author || "";
    return {
      citation,
      index,
      key: fold(citation.key),
      surnames: (citation.surnames?.length ? citation.surnames : [citation.author ?? ""]).map(fold),
      year: citation.year ?? "",
      title,
      words,
      base: [who, citation.year].filter(Boolean).join(" "),
    };
  });
  memo = { citations, owners, document, entries };
  return entries;
}

export type Ranked = {
  citation: Citation;
  /** Matched letters in the key, as from/to pairs. */
  label: number[];
  /** The detail column's text and its matched letters. */
  detail: string;
  marks: number[];
};

/** How many a list shows at most. */
export const CAP = 200;

/** The entries that match `segment`, best first: the key's start, then
 *  anywhere in the key, then an author's surname, the year, a word of the
 *  title, and last the key's letters in order with gaps between. */
export function rankCitations(entries: Entry[], segment: string, excluded: Set<string>): Ranked[] {
  const query = fold(segment.trim());
  const found: { tier: number; at: number; entry: Entry; ranked: Ranked }[] = [];
  for (const entry of entries) {
    if (excluded.has(entry.citation.key)) continue;
    const hit = matchOne(entry, query);
    if (hit) found.push({ ...hit, entry });
  }
  // Nothing typed yet: the bibliography's own order, which is the
  // writer's.
  if (query) found.sort(
    (a, b) =>
      a.tier - b.tier || a.at - b.at || a.entry.key.length - b.entry.key.length || a.entry.index - b.entry.index,
  );
  return found.slice(0, CAP).map((hit) => hit.ranked);
}

function matchOne(entry: Entry, query: string): { tier: number; at: number; ranked: Ranked } | null {
  const plain = (label: number[], tier: number, at: number) => ({
    tier, at, ranked: { citation: entry.citation, label, detail: entry.base, marks: [] },
  });
  if (!query) return plain([], 0, 0);
  const inKey = entry.key.indexOf(query);
  if (inKey === 0) return plain([0, query.length], 0, 0);
  if (inKey > 0) return plain([inKey, inKey + query.length], 1, inKey);

  for (const [n, surname] of entry.surnames.entries()) {
    if (!surname.startsWith(query)) continue;
    const name = entry.citation.surnames?.[n] ?? entry.citation.author ?? "";
    // The surname where the detail column shows it, or added to it when
    // the short author line has cut it.
    let detail = entry.base;
    let at = wordAt(fold(detail), surname);
    if (at < 0) {
      detail = entry.base ? `${entry.base}, ${name}` : name;
      at = detail.length - name.length;
    }
    return { tier: 2, at: n, ranked: { citation: entry.citation, label: [], detail, marks: [at, at + query.length] } };
  }

  if (entry.year.startsWith(query)) {
    const at = entry.base.lastIndexOf(entry.year);
    return { tier: 3, at: 0, ranked: { citation: entry.citation, label: [], detail: entry.base, marks: at >= 0 ? [at, at + query.length] : [] } };
  }

  for (const start of entry.words) {
    if (!entry.title.startsWith(query, start)) continue;
    // The first author alone beside a title, so the two fit the popup.
    const { text, offset } = titleAround(entry.citation.title, start);
    const who = [entry.citation.author, entry.year].filter(Boolean).join(" ");
    const detail = who ? `${who}, ${text}` : text;
    const at = detail.length - text.length + offset;
    return { tier: 4, at: start, ranked: { citation: entry.citation, label: [], detail, marks: [at, at + query.length] } };
  }

  const letters = subsequence(entry.key, query);
  if (letters) return { tier: 5, at: letters[0], ranked: { citation: entry.citation, label: letters, detail: entry.base, marks: [] } };
  return null;
}

/** The query's letters in the key in order, as merged from/to pairs, or
 *  null when they are not all there. */
function subsequence(key: string, query: string): number[] | null {
  const ranges: number[] = [];
  let from = 0;
  for (const ch of query) {
    const at = key.indexOf(ch, from);
    if (at < 0) return null;
    if (ranges.length && ranges[ranges.length - 1] === at) ranges[ranges.length - 1] = at + 1;
    else ranges.push(at, at + 1);
    from = at + 1;
  }
  return ranges;
}

/** How much of a title the detail column has room for. */
export const TITLE_ROOM = 24;

/** The part of a title to show beside the author, so the matched word is
 *  on screen in a popup a few hundred pixels wide: from the start when
 *  the word is near it, else from the word with an ellipsis before, and
 *  cut with an ellipsis after.  `offset` is where the word now starts. */
export function titleAround(title: string, start: number): { text: string; offset: number } {
  const from = start < 12 ? 0 : start;
  let text = title.slice(from);
  if (text.length > TITLE_ROOM) text = `${text.slice(0, TITLE_ROOM - 1).trimEnd()}\u2026`;
  return from ? { text: `\u2026${text}`, offset: start - from + 1 } : { text, offset: start };
}

/** Where `word` starts a word in `text`, or -1. */
function wordAt(text: string, word: string): number {
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !/[a-z]/.test(text[at - 1])) return at;
  }
  return -1;
}

/** What taking `key` puts in the text, given what follows the replaced
 *  range on the line, and where the caret goes, as an offset from the
 *  start of the insertion.
 *
 *  A brace straight after is stepped over rather than doubled; before a
 *  comma, or with the list's closing brace further on, the key goes in
 *  alone; at the end of an open argument the brace is closed, since an
 *  unclosed brace in a citation is a fatal error (Q-068). */
export function citeInsertion(after: string, key: string): { insert: string; caret: number } {
  if (after.startsWith("}")) return { insert: key, caret: key.length + 1 };
  const close = after.indexOf("}");
  const open = after.indexOf("{");
  if (after.startsWith(",") || (close >= 0 && (open < 0 || close < open))) {
    return { insert: key, caret: key.length };
  }
  return { insert: `${key}}`, caret: key.length + 1 };
}
