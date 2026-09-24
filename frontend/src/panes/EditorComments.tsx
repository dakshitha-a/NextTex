/** Comments in the editor: the marks, the preview under the pointer, the
 *  composer and the thread card.
 *
 *  A lazy chunk beside the editor rather than inside it, for the bundle's
 *  sake: the entry chunk has a budget, and comments are something a writer
 *  meets after the page, not before it. The editor holds the extension's
 *  place, `commentCompartment`, and this fills it; the editor calls
 *  `apply` after every swap, because each file's state starts the
 *  compartment empty, and `start` from the selection toolbar. See the
 *  direction page's Comments section and docs/design.md section 66. */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import api from "../api";
import type { ProjectCollab } from "../collab";
import { get, refreshComments, set, useStore } from "../store";
import { uiScale } from "../viewport";
import { commentExtension, setComments, type CommentHandlers } from "./comment-marks";
import { commentCompartment } from "./editor-setup";
import { placeClear } from "./place-clear";

const CommentComposer = lazy(() => import("./CommentCards").then((m) => ({ default: m.CommentComposer })));
const CommentPreview = lazy(() => import("./CommentCards").then((m) => ({ default: m.CommentPreview })));
const CommentThreadCard = lazy(() => import("./CommentCards").then((m) => ({ default: m.CommentThreadCard })));

/** What the editor may ask of this component. */
export type CommentsApi = {
  /** Put the extension in the view's state and draw the marks: after a swap. */
  apply: () => void;
  /** Start a comment on the selection; false when there is nothing to
   *  comment on here. */
  start: () => boolean;
};

type Shared = import("yjs").Text;

export default function EditorComments({
  view, host, current, viewing, sharedOf, collab, handle,
}: {
  view: MutableRefObject<EditorView | null>;
  host: MutableRefObject<HTMLDivElement | null>;
  /** The path the view holds, or null while an old version is shown. */
  current: MutableRefObject<string | null>;
  viewing: MutableRefObject<unknown>;
  /** The shared text of a file the editor has open. */
  sharedOf: (path: string) => Shared | undefined;
  collab: MutableRefObject<ProjectCollab | null>;
  handle: MutableRefObject<CommentsApi | null>;
}) {
  const [card, setCard] = useState<
    | { kind: "compose"; from: number; to: number; quote: string; line: number; left: number; top: number }
    | { kind: "thread"; id: string; left: number; top: number }
    | null
  >(null);
  const [preview, setPreview] = useState<{ ids: string[]; left: number; top: number } | null>(null);
  const size = useRef<{ width: number; height: number }>({ width: 320, height: 160 });
  const timer = useRef<number | null>(null);
  const threads = useStore((s) => s.comments);
  const openId = useStore((s) => s.openThread);

  /** Where a card goes for a range of the document: clear of every line
   *  the range touches, as the verb row is, in shell pixels. */
  const placeRange = useCallback((from: number, to: number) => {
    const editor = view.current;
    const pane = host.current;
    const frame = pane?.getBoundingClientRect();
    if (!editor || !pane || !frame) return null;
    const scale = uiScale();
    const length = editor.state.doc.length;
    const firstBlock = editor.lineBlockAt(Math.min(from, length));
    const lastBlock = editor.lineBlockAt(Math.min(to, length));
    const origin = (editor.documentTop - frame.top) / scale;
    const left = ((editor.coordsAtPos(Math.min(from, length))?.left ?? frame.left) - frame.left) / scale;
    return placeClear(
      { top: firstBlock.top / scale + origin, bottom: firstBlock.bottom / scale + origin, left },
      { top: lastBlock.top / scale + origin, bottom: lastBlock.bottom / scale + origin, left },
      { width: pane.offsetWidth, height: pane.offsetHeight },
      size.current,
    );
  }, [view, host]);

  /** The open threads of the file on screen, placed. */
  const marks = useCallback(() => {
    const path = current.current;
    const shared = path ? sharedOf(path) : undefined;
    if (!path || !shared || !collab.current || viewing.current) return [];
    return collab.current.commentMarks(get().comments, path, shared, get().openThread);
  }, [current, sharedOf, collab, viewing]);

  const draw = useCallback(() => {
    view.current?.dispatch({ effects: setComments.of(marks()) });
  }, [view, marks]);

  const openThread = useCallback((id: string) => {
    const mark = marks().find((each) => each.id === id);
    if (get().openThread !== id) set({ openThread: id });
    setPreview(null);
    const at = mark ? placeRange(mark.from, mark.to) : null;
    if (at) setCard({ kind: "thread", id, left: at.left, top: at.top });
  }, [marks, placeRange]);

  /** The card of the thread the store names, when its file is the one on
   *  screen: a click in the drawer opens the file first, and the card
   *  follows once the file has arrived. */
  const reopen = useCallback(() => {
    const id = get().openThread;
    if (!id) return;
    const thread = get().comments.find((each) => each.id === id);
    if (!thread || thread.path !== current.current) return;
    openThread(id);
  }, [current, openThread]);

  const redraw = useRef<number | null>(null);
  const handlers = useRef<CommentHandlers>({
    open: () => {}, hover: () => {}, changed: () => {}, dismiss: () => false,
  });
  const cardRef = useRef(card);
  cardRef.current = card;
  handlers.current = {
    open: (id) => openThread(id),
    hover: (ids) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (!ids || !ids.length) {
          setPreview(null);
          return;
        }
        const placed = marks().filter((each) => ids.includes(each.id));
        if (!placed.length) return;
        const at = placeRange(placed[0].from, placed[placed.length - 1].to);
        if (at) setPreview({ ids: placed.map((each) => each.id), left: at.left, top: at.top });
        // The wait the hover cards use before they come, and a shorter one
        // before it goes, so passing over a comment does not flash it.
      }, ids && ids.length ? 250 : 120);
    },
    dismiss: () => {
      if (!cardRef.current) return false;
      setCard(null);
      if (get().openThread) set({ openThread: null });
      return true;
    },
    changed: () => {
      if (redraw.current !== null) window.clearTimeout(redraw.current);
      redraw.current = window.setTimeout(() => {
        redraw.current = null;
        draw();
      }, 200);
    },
  };

  const start = useCallback(() => {
    const editor = view.current;
    const path = current.current;
    if (!editor || !path || viewing.current || !sharedOf(path)) return false;
    const range = editor.state.selection.main;
    if (range.empty) return false;
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    const at = placeRange(from, to);
    if (!at) return false;
    setCard({
      kind: "compose", from, to,
      quote: editor.state.sliceDoc(from, Math.min(to, from + 400)),
      line: editor.state.doc.lineAt(from).number,
      left: at.left, top: at.top,
    });
    return true;
  }, [view, current, viewing, sharedOf, placeRange]);
  const startRef = useRef(start);
  startRef.current = start;

  const apply = useCallback(() => {
    const editor = view.current;
    if (!editor) return;
    setCard(null);
    setPreview(null);
    editor.dispatch({
      effects: commentCompartment.reconfigure(
        commentExtension(() => handlers.current, () => startRef.current()),
      ),
    });
    // A second transaction: the field the first one added does not see
    // the effects of the transaction that created it.
    draw();
    reopen();
  }, [view, draw, reopen]);

  handle.current = { apply, start };
  useEffect(() => {
    apply();
    return () => {
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    if (!openId) {
      setCard((open) => (open?.kind === "thread" ? null : open));
    } else if (card?.kind !== "thread" || card.id !== openId) {
      reopen();
    }
    if (card?.kind === "thread" && !threads.some((each) => each.id === card.id)) setCard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, openId, draw]);

  // Escape anywhere puts an open card away, as it does a menu: a click on
  // the gutter's icon leaves the focus where it was, often on the page.
  useEffect(() => {
    if (!card) return;
    const away = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setCard(null);
      if (get().openThread) set({ openThread: null });
    };
    window.addEventListener("keydown", away);
    return () => window.removeEventListener("keydown", away);
  }, [card]);

  const post = async (body: string) => {
    const projectId = get().projectId;
    const path = current.current;
    const shared = path ? sharedOf(path) : undefined;
    if (!card || card.kind !== "compose" || !projectId || !path || !shared || !collab.current) {
      throw new Error("The file is not connected to the project's shared documents.");
    }
    const anchors = collab.current.commentAnchors(shared, card.from, card.to);
    await api.comment(projectId, { path, ...anchors, quote: card.quote, line: card.line, body });
    setCard(null);
    await refreshComments(projectId);
    view.current?.focus();
  };

  const act = async (what: "reply" | "resolve" | "delete", id: string, body = "") => {
    const projectId = get().projectId;
    if (!projectId) return;
    if (what !== "reply") {
      setCard(null);
      set({ openThread: null });
    }
    if (what === "reply") await api.replyComment(projectId, id, body);
    else if (what === "resolve") await api.resolveComment(projectId, id, true);
    else await api.deleteComment(projectId, id);
    await refreshComments(projectId);
  };

  /** A card's real size once drawn. The first placement guessed it; with
   *  the real one the card moves if the guess put it over its own text,
   *  the way the verb row does. */
  const remember = (measured: { width: number; height: number }) => {
    const before = size.current;
    size.current = measured;
    if (before.width === measured.width && before.height === measured.height) return;
    const range = (id: string) => marks().find((each) => each.id === id);
    setCard((open) => {
      if (!open) return open;
      const place = open.kind === "compose" ? { from: open.from, to: open.to } : range(open.id);
      const at = place ? placeRange(place.from, place.to) : null;
      return at && (at.left !== open.left || at.top !== open.top) ? { ...open, ...at } : open;
    });
    setPreview((open) => {
      if (!open) return open;
      const placed = open.ids.map(range).filter(Boolean) as { from: number; to: number }[];
      if (!placed.length) return open;
      const at = placeRange(placed[0].from, placed[placed.length - 1].to);
      return at && (at.left !== open.left || at.top !== open.top) ? { ...open, ...at } : open;
    });
  };
  const shown = card?.kind === "thread" ? threads.find((each) => each.id === card.id) : undefined;

  return (
    <Suspense fallback={null}>
      {preview && !card ? (
        <CommentPreview
          at={{ left: preview.left, top: preview.top }}
          threads={threads.filter((each) => preview.ids.includes(each.id))}
          onMeasure={remember}
        />
      ) : null}
      {card?.kind === "compose" ? (
        <CommentComposer
          at={{ left: card.left, top: card.top }}
          quote={card.quote}
          onMeasure={remember}
          onPost={post}
          onCancel={() => {
            setCard(null);
            view.current?.focus();
          }}
        />
      ) : null}
      {card?.kind === "thread" && shown ? (
        <CommentThreadCard
          at={{ left: card.left, top: card.top }}
          thread={shown}
          onMeasure={remember}
          onReply={(body) => act("reply", card.id, body)}
          onResolve={() => void act("resolve", card.id)}
          onDelete={() => void act("delete", card.id)}
          onClose={() => {
            setCard(null);
            set({ openThread: null });
            view.current?.focus();
          }}
        />
      ) : null}
    </Suspense>
  );
}
