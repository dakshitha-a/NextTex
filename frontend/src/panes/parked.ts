/** Bringing a parked editor state back into step with its shared text.
 *
 *  A tab that is not in front keeps its `EditorState` parked, with its
 *  undo history and its caret, and the view holds the file in front.  The
 *  collaboration binding is a view plugin: it watches the shared `Y.Text`
 *  only while its state is the one in the view, and putting the parked
 *  state back builds a fresh plugin that assumes the two already agree.
 *  So an outside rewrite, an agent's edit or a collaborator's typing in a
 *  file that was open but not in front changed the shared text and not the
 *  parked state, the tab came back showing what it showed before, and the
 *  next remote change was spliced into the wrong offsets: "hTWe" in the
 *  middle of "here".
 *
 *  The cure is one minimal change on the parked state, from the shared
 *  text, before the state goes back into the view.  Minimal, as a common
 *  prefix and suffix, so the caret and the selection move with the text
 *  the way they do for an edit made in front.
 */

import { EditorState } from "@codemirror/state";

/** The smallest replacement that turns `have` into `want`, as a
 *  CodeMirror change, or null when they already agree. */
export function changeBetween(
  have: string,
  want: string,
): { from: number; to: number; insert: string } | null {
  if (have === want) return null;
  const shortest = Math.min(have.length, want.length);
  let from = 0;
  while (from < shortest && have.charCodeAt(from) === want.charCodeAt(from)) from += 1;
  let tail = 0;
  while (
    tail < shortest - from &&
    have.charCodeAt(have.length - 1 - tail) === want.charCodeAt(want.length - 1 - tail)
  ) {
    tail += 1;
  }
  return { from, to: have.length - tail, insert: want.slice(from, want.length - tail) };
}

/** The parked state with the shared text folded in, or the same state
 *  when nothing moved while it was parked. */
export function reconciled(state: EditorState, shared: string): EditorState {
  const change = changeBetween(state.doc.toString(), shared);
  if (!change) return state;
  return state.update({ changes: change }).state;
}
