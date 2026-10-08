/** Edits made after the build and before the click.
 *
 *  Each one changes the source the editor holds while the PDF, and so the
 *  line synctex answers with, stays as it was built. `move` says where a
 *  line of the built source is after the edit.
 */

export type Edit = {
  name: string;
  file: string;
  apply: (lines: string[]) => void;
  move: (line: number) => number;
};

const insert = (name: string, at: number, count: number): Edit => ({
  name,
  file: "stress.tex",
  apply: (lines) => lines.splice(at - 1, 0, ...Array.from({ length: count }, (_, i) => `Inserted paragraph ${i} of filler text about something else entirely.`)),
  move: (line) => (line >= at ? line + count : line),
});

export const EDITS: Edit[] = [
  insert("insert-5", 6, 5),
  insert("insert-50", 6, 50),
  insert("insert-500", 6, 500),
  {
    name: "delete-2",
    file: "stress.tex",
    // Two lines above everything typeset: the page style and a blank.
    apply: (lines) => { lines.splice(4, 1); lines.splice(2, 1); },
    move: (line) => (line > 5 ? line - 2 : line > 3 ? line - 1 : line),
  },
];
