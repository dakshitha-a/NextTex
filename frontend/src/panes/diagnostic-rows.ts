/** The order the diagnostics drawer lists things in, and how it names them.
 *
 *  Two bugs shared this file. The list was sorted `localeCompare` on the
 *  filename, which is the same alphabetical sort the server's summary used
 *  and is wrong for the same reason: `chapters/one.tex` sorts before
 *  `main.tex`, and a broken preamble makes every chapter complain, so the
 *  row at the top of the drawer was a consequence of the error the writer
 *  actually has to fix. The comment above it said "the first row is always
 *  the one most worth reading".
 *
 *  And which row was open, and which was selected, were **indices into this
 *  list**. The list is rebuilt from scratch on every build, so a build that
 *  reordered it left the expansion and the selection bar on whichever
 *  diagnostics happened to land in those two slots: a row the writer never
 *  opened and never chose.
 */

export type Row = {
  severity: string;
  file?: string | null;
  line?: number | null;
  message?: string;
  document?: string;
  [more: string]: unknown;
};

/** A diagnostic's identity, which is not its position.
 *
 *  The same fields `Diagnostic.key()` uses on the server, for the same
 *  reason: two errors can share a file and a line and differ in what they
 *  say, and the same error moves up and down a file all day. */
export function rowKey(row: Row): string {
  return [row.document ?? "", row.file ?? "", row.line ?? 0, row.message ?? ""]
    .join(" ");
}

/**
 * Errors before warnings, and otherwise the order the engine met them in.
 *
 * Deliberately a stable sort on severity alone. The log's order is the
 * document's order, because that is the order the engine read it, and any
 * sort on the filename replaces that with the alphabet.
 */
export function orderRows<T extends Row>(compile: T[], lint: T[]): T[] {
  return [...compile, ...lint]
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      const first = a.row.severity === "error" ? 0 : 1;
      const second = b.row.severity === "error" ? 0 : 1;
      return first - second || a.at - b.at;
    })
    .map((held) => held.row);
}
