import {
  autocompletion,
  snippetCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

/** Completion inside a `.bib` file.
 *
 *  Two things are typed into a bibliography more than anything else: the
 *  head of a new entry, and the next field of the one being filled in. A
 *  `@` at the start of a line offers the entry types, each a snippet with
 *  the key first and the type's required fields as tab stops in the order
 *  they are usually written; a bare word at the start of a line inside an
 *  entry offers that type's fields, required first, each as `name = {}`
 *  with the caret inside the braces.
 *
 *  The table mirrors `REQUIRED` and `OPTIONAL` in `nexttex/bibcheck.py`,
 *  which is what the drawer's rows are checked against; the Python test
 *  asserts the type names and `bib-complete.test.ts` the other way, so
 *  the two cannot drift apart without a test saying so.
 */

export const ENTRY_TYPES: Record<string, { required: string[]; optional: string[] }> = {
  article: { required: ["author", "title", "journal", "year"], optional: ["volume", "number", "pages", "month", "doi", "note"] },
  book: { required: ["author", "title", "publisher", "year"], optional: ["editor", "volume", "series", "address", "edition", "month", "isbn", "note"] },
  booklet: { required: ["title"], optional: ["author", "howpublished", "address", "month", "year", "note"] },
  inbook: { required: ["author", "title", "chapter", "publisher", "year"], optional: ["editor", "pages", "volume", "series", "address", "edition"] },
  incollection: { required: ["author", "title", "booktitle", "publisher", "year"], optional: ["editor", "volume", "series", "chapter", "pages", "address", "edition"] },
  inproceedings: { required: ["author", "title", "booktitle", "year"], optional: ["editor", "volume", "series", "pages", "address", "organization", "publisher", "doi"] },
  conference: { required: ["author", "title", "booktitle", "year"], optional: ["editor", "volume", "series", "pages", "address", "organization", "publisher", "doi"] },
  manual: { required: ["title"], optional: ["author", "organization", "address", "edition", "month", "year", "note"] },
  mastersthesis: { required: ["author", "title", "school", "year"], optional: ["type", "address", "month", "url"] },
  phdthesis: { required: ["author", "title", "school", "year"], optional: ["type", "address", "month", "url"] },
  misc: { required: [], optional: ["author", "title", "howpublished", "year", "url", "note"] },
  proceedings: { required: ["title", "year"], optional: ["editor", "volume", "series", "address", "organization", "publisher"] },
  techreport: { required: ["author", "title", "institution", "year"], optional: ["type", "number", "address", "month", "url"] },
  unpublished: { required: ["author", "title", "note"], optional: ["month", "year", "url"] },
  online: { required: ["title", "url"], optional: ["author", "year", "urldate"] },
  software: { required: ["title"], optional: ["author", "version", "url", "year"] },
  thesis: { required: ["author", "title", "type", "institution", "year"], optional: ["address", "url"] },
  report: { required: ["author", "title", "type", "institution", "year"], optional: ["number", "address", "url"] },
  collection: { required: ["editor", "title", "year"], optional: ["publisher", "address", "series"] },
};

/** The snippet a type expands to: the key first, then its required
 *  fields, one per line, each a tab stop. */
export function entrySnippet(type: string): string {
  const fields = ENTRY_TYPES[type]?.required ?? [];
  const lines = fields.map((name) => `  ${name} = {#{}},`);
  return [`@${type}{#{key},`, ...lines, "}"].join("\n");
}

/** Which entry the line at `pos` sits inside, by the nearest `@type{`
 *  above it that has not been closed by a `}` on a line of its own. */
export function enclosingType(doc: { lineAt(pos: number): { number: number; from: number; text: string }; line(n: number): { text: string } }, pos: number): string | null {
  const start = doc.lineAt(pos).number;
  // Eighty lines is more than any entry has.
  for (let n = start - 1; n >= Math.max(1, start - 80); n -= 1) {
    const text = doc.line(n).text;
    if (/^\s*}\s*$/.test(text)) return null;
    const head = /^\s*@(\w+)\s*\{/.exec(text);
    if (head) return head[1].toLowerCase();
  }
  return null;
}

/** The completion list at one position, pure so a test can ask it. */
export function bibSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);

  const head = /^\s*@(\w*)$/.exec(before);
  if (head) {
    return {
      from: context.pos - head[1].length - 1,
      validFor: /^@\w*$/,
      options: Object.keys(ENTRY_TYPES).map((type) =>
        snippetCompletion(entrySnippet(type), {
          label: `@${type}`,
          detail: ENTRY_TYPES[type].required.join(", ") || "anything",
          type: "type",
        }),
      ),
    };
  }

  const field = /^\s*([a-zA-Z]*)$/.exec(before);
  if (field && (field[1].length > 0 || context.explicit)) {
    const type = enclosingType(context.state.doc, context.pos);
    if (!type) return null;
    const known = ENTRY_TYPES[type];
    if (!known) return null;
    const names = [...known.required, ...known.optional.filter((name) => !known.required.includes(name))];
    return {
      from: context.pos - field[1].length,
      validFor: /^[a-zA-Z]*$/,
      options: names.map((name, index) =>
        snippetCompletion(`${name} = {#{}},`, {
          label: name,
          detail: index < known.required.length ? "required" : undefined,
          type: "property",
        }),
      ),
    };
  }
  return null;
}

export function bibCompletions(): Extension {
  return autocompletion({
    override: [bibSource],
    activateOnTyping: true,
    icons: false,
    closeOnBlur: true,
  });
}
