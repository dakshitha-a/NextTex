import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim, Vim } from "@replit/codemirror-vim";
import { emacs, EmacsHandler } from "../vendor/codemirror-emacs";
import { yUndoManagerKeymap } from "y-codemirror.next";

/** Vim and Emacs, fetched only when chosen.
 *
 *  A session that does not want a keymap pays nothing: this module is a
 *  chunk of its own, imported by the editor the first time the setting is
 *  not `default`, and `keymapCompartment` holds `[]` until then.
 *
 *  Undo stays the document's.  `docs/architecture.md` records why a live
 *  editor has no CodeMirror `history()`: the shared document has its own
 *  undo manager, scoped to this writer's changes, and two histories over
 *  one document once emptied a file for everyone.  Both packages bind
 *  their undo to CodeMirror's `undo` command from `@codemirror/commands`,
 *  which with no history in the state does nothing, so `u` in Vim and
 *  `C-/` in Emacs would have been dead keys.  Each is rebound here to the
 *  commands `yUndoManagerKeymap` runs, which are the document's, through
 *  the override each package offers: Vim's `defineAction` replaces the
 *  `undo` and `redo` actions its `u` and `<C-r>` name, and Emacs's
 *  `bindKey` rebinds the four spellings of each.
 */

const yUndo = yUndoManagerKeymap.find((binding) => binding.key === "Mod-z")!.run!;
const yRedo = yUndoManagerKeymap.find((binding) => binding.key === "Mod-Shift-z")!.run!;

/** The document's undo, or nothing on a view that has no document behind
 *  it, which a read-only pane is; a keymap is never installed there, but
 *  a command that throws is not a way to find that out. */
export function undoDocument(view: EditorView): boolean {
  try {
    return yUndo(view);
  } catch {
    return false;
  }
}

export function redoDocument(view: EditorView): boolean {
  try {
    return yRedo(view);
  } catch {
    return false;
  }
}

let vimBound = false;
let emacsBound = false;

export function vimExtension(): Extension {
  if (!vimBound) {
    // `cm` is the package's CodeMirror 5 shaped adapter; `cm6` is the view.
    Vim.defineAction("undo", (cm: { cm6: EditorView }) => { undoDocument(cm.cm6); });
    Vim.defineAction("redo", (cm: { cm6: EditorView }) => { redoDocument(cm.cm6); });
    vimBound = true;
  }
  return vim({ status: true });
}

export function emacsExtension(): Extension {
  if (!emacsBound) {
    // The keys and the commands come with the vendored module; its header
    // says why it is vendored rather than imported from the package.
    EmacsHandler.bindKey("C-/|C-x u|S-C--|C-z", undoDocument);
    EmacsHandler.bindKey("S-C-/|S-C-x u|C--|S-C-z", redoDocument);
    emacsBound = true;
  }
  return emacs();
}
