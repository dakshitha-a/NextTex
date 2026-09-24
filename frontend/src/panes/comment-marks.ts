/** Comment threads in the editor: the underline, the icon beside the line
 *  number, and where each thread's text is now.
 *
 *  A thread's anchors are two Yjs relative positions into the file's
 *  shared text, made when the thread was, so they follow every edit, a
 *  collaborator's and an outside one as much as this writer's. The
 *  editor's positions are the shared text's positions (y-codemirror binds
 *  them one to one, both counting UTF-16 units), so resolving an anchor
 *  against the document is the whole of finding the range.
 *
 *  The range rests as an underline in the hint colour, the colour the
 *  guide gives what is "safe and interactive", and takes the hint wash
 *  while its thread is open; the find cursor, the other user of the hint,
 *  is an outlined box, so the two do not read alike. A resolved thread is
 *  not drawn at all. The icon is in a gutter of its own, left of the line
 *  numbers, because the error and warning bars are box-shadows on the
 *  line and cannot be clicked.
 *
 *  Nothing here imports Yjs, which would pull it into the entry bundle;
 *  the anchors are resolved in `comment-anchors.ts`, which only the lazily
 *  loaded collaboration client imports. */

import { Prec, RangeSet, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

export type CommentMark = { id: string; from: number; to: number; open: boolean };

/** The threads of the file on screen, placed. */
export const setComments = StateEffect.define<CommentMark[]>();

const rangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(current, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setComments)) continue;
      const length = tr.state.doc.length;
      return Decoration.set(
        effect.value
          .filter((mark) => mark.to <= length)
          .map((mark) =>
            Decoration.mark({
              class: mark.open ? "nx-comment nx-comment-open" : "nx-comment",
              attributes: { "data-comment": mark.id },
            }).range(mark.from, mark.to),
          ),
        true,
      );
    }
    return tr.docChanged ? current.map(tr.changes) : current;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class CommentIcon extends GutterMarker {
  constructor(readonly ids: string[]) {
    super();
  }
  eq(other: CommentIcon) {
    return other.ids.join() === this.ids.join();
  }
  toDOM() {
    if (!this.ids.length) {
      // The gutter's spacer: its width, and nothing to find or click.
      const spacer = document.createElement("span");
      spacer.className = "nx-comment-spacer";
      return spacer;
    }
    const button = document.createElement("span");
    button.className = "nx-comment-icon";
    button.dataset.comments = this.ids.join(" ");
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label", this.ids.length === 1 ? "Open the comment" : `Open ${this.ids.length} comments`,
    );
    // The set's speech bubble, at the gutter's size.
    button.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5l-3 2.5V11H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>' +
      '<path d="M5 6h6M5 8.2h3.5"/></svg>';
    return button;
  }
}

const iconField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(current, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setComments)) continue;
      const byLine = new Map<number, string[]>();
      for (const mark of effect.value) {
        if (mark.from > tr.state.doc.length) continue;
        const start = tr.state.doc.lineAt(mark.from).from;
        byLine.set(start, [...(byLine.get(start) ?? []), mark.id]);
      }
      return RangeSet.of(
        [...byLine].sort((a, b) => a[0] - b[0]).map(([at, ids]) => new CommentIcon(ids).range(at)),
      );
    }
    return tr.docChanged ? current.map(tr.changes) : current;
  },
});

export type CommentHandlers = {
  /** A click on the washed text or on the icon: open this thread. */
  open: (id: string, anchor: DOMRect) => void;
  /** The pointer resting on a thread's text or icon, or leaving it. */
  hover: (ids: string[] | null, anchor: DOMRect | null) => void;
  /** The text changed: place the threads again, a moment later. A thread
   *  whose words had not arrived when the file opened, or come back with an
   *  undo, has no mark to map and only appears when it is placed afresh. */
  changed: () => void;
  /** Escape, or a click in the text away from any thread: put the open
   *  card away. True when there was one to put away. */
  dismiss: () => boolean;
};

/** The whole of it, for the editor's extension list. */
export function commentExtension(
  handlers: () => CommentHandlers,
  /** Ctrl-Alt-M: start a comment on the selection, the key other editors
   *  put commenting on. */
  start: () => boolean,
): Extension {
  const idsAt = (target: EventTarget | null): { ids: string[]; box: DOMRect } | null => {
    const element = (target as HTMLElement | null)?.closest?.("[data-comment], [data-comments]") as
      | HTMLElement
      | null;
    if (!element) return null;
    const ids = (element.dataset.comment ?? element.dataset.comments ?? "").split(" ").filter(Boolean);
    return ids.length ? { ids, box: element.getBoundingClientRect() } : null;
  };
  return [
    rangeField,
    iconField,
    keymap.of([{ key: "Mod-Alt-m", run: () => start() }]),
    // Ahead of CodeMirror's own Escape, which collapses a selection: it
    // acts only while a comment card is open, and says so by returning
    // false otherwise.
    Prec.highest(keymap.of([{ key: "Escape", run: () => handlers().dismiss() }])),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers().changed();
    }),
    Prec.highest(
      gutter({
        class: "nx-comment-gutter",
        markers: (view) => view.state.field(iconField),
        initialSpacer: () => new CommentIcon([]),
        domEventHandlers: {
          click: (_view, _line, event) => {
            const hit = idsAt(event.target);
            if (!hit) return false;
            handlers().open(hit.ids[0], hit.box);
            return true;
          },
          mouseover: (_view, _line, event) => {
            const hit = idsAt(event.target);
            handlers().hover(hit ? hit.ids : null, hit ? hit.box : null);
            return false;
          },
          mouseout: () => {
            handlers().hover(null, null);
            return false;
          },
        },
      }),
    ),
    EditorView.domEventHandlers({
      mouseover: (event) => {
        const hit = idsAt(event.target);
        handlers().hover(hit ? hit.ids : null, hit ? hit.box : null);
        return false;
      },
      click: (event) => {
        // A plain click on the washed text: a selection or a caret move
        // made with a modifier is the writer editing, not opening.
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const hit = idsAt(event.target);
        if (!hit) {
          handlers().dismiss();
          return false;
        }
        handlers().open(hit.ids[0], hit.box);
        return false;
      },
    }),
  ];
}
