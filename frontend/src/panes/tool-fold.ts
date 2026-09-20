import type { ChatItem } from "../store";
import { verbFor } from "./tool-verb";

/** Consecutive tool calls folded into one line.
 *
 *  A turn that reads a file, searches the bibliography and runs latexmk
 *  is three rows of the third ink under a question, and a turn that does
 *  it twenty times is twenty; the direction page draws the run as one
 *  sentence, "Read main.tex, searched the bibliography, ran latexmk", with
 *  the run's whole time at the right, opening to the rows themselves.
 *  Applied after `tidy`, which has already merged identical repeats and
 *  attached each card to its call.
 *
 *  Two rows never fold. One whose card is still open is a question with
 *  four buttons on it, and a question inside a closed group is a question
 *  the writer cannot see. One whose card was answered carries the answer
 *  as its own testid (`decided-auto`, `decided-allow`), and at the quiet
 *  positions that row is the only record that the action happened; it
 *  stays on its own line. A run of one is a row, not a group of one.
 */
export type ToolRow = Extract<ChatItem, { kind: "tool" }>;

export type ToolGroup = {
  kind: "tools";
  id: string;
  items: ToolRow[];
  /** The run's whole cost, when every row has come back with one. */
  ms?: number;
  /** False when any call in the run failed. */
  ok: boolean;
};

export type ShownItem = ChatItem | ToolGroup;

function plain(item: ToolRow): boolean {
  return !item.card;
}

export function foldTools(items: ChatItem[]): ShownItem[] {
  const out: ShownItem[] = [];
  let run: ToolRow[] = [];
  const flush = () => {
    if (run.length > 1) {
      const every = run.every((row) => row.ms != null);
      out.push({
        kind: "tools",
        id: `tools:${run[0].id}`,
        items: run,
        ms: every ? run.reduce((sum, row) => sum + (row.ms ?? 0), 0) : undefined,
        ok: run.every((row) => row.ok !== false),
      });
    } else if (run.length === 1) {
      out.push(run[0]);
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool" && plain(item)) {
      run.push(item);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
}

/** The sentence a folded run reads as: the first verb as it is, the rest
 *  lowercased, each with what it was done to. */
export function foldedSentence(group: ToolGroup): string {
  return group.items
    .map((row, index) => {
      const verb = verbFor(row.name);
      const said = index === 0 ? verb : verb.charAt(0).toLowerCase() + verb.slice(1);
      const what = row.summary ? ` ${row.summary}` : "";
      const times = row.repeats && row.repeats > 1 ? ` ×${row.repeats}` : "";
      return `${said}${what}${times}`;
    })
    .join(", ");
}
