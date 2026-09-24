/** A comment thread's anchors, against a file's shared text.
 *
 *  Kept apart from `comment-marks.ts` because it imports Yjs, and only the
 *  collaboration client, which is loaded lazily, may: see `remoteMarker`
 *  in `collab.ts`. */

import * as Y from "yjs";

import type { CommentThread } from "../api";
import type { CommentMark } from "./comment-marks";

/** Where a thread's text is in a shared text now, or null when its text
 *  has gone or its anchors belong to some other document. */
export function placeThread(thread: CommentThread, text: Y.Text): { from: number; to: number } | null {
  const doc = text.doc;
  if (!doc) return null;
  const at = (anchor: string) => {
    try {
      const bytes = Uint8Array.from(atob(anchor), (c) => c.charCodeAt(0));
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(bytes), doc,
      );
      return absolute && absolute.type === text ? absolute.index : null;
    } catch {
      return null;
    }
  };
  const from = at(thread.start);
  const to = at(thread.end);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/** A range's two ends as the server keeps them: the start holding to the
 *  text after it and the end to the text before it, so typing at either
 *  edge stays outside the thread. */
export function anchorsFor(text: Y.Text, from: number, to: number): { start: string; end: string } {
  const encode = (index: number, assoc: number) =>
    btoa(String.fromCharCode(...Y.encodeRelativePosition(
      Y.createRelativePositionFromTypeIndex(text, index, assoc),
    )));
  return { start: encode(from, 0), end: encode(to, -1) };
}

/** The marks for the open threads of one file. */
export function marksFor(
  threads: CommentThread[], path: string, text: Y.Text, open: string | null,
): CommentMark[] {
  const marks: CommentMark[] = [];
  for (const thread of threads) {
    if (thread.path !== path || thread.resolved?.at) continue;
    const place = placeThread(thread, text);
    if (place) marks.push({ id: thread.id, ...place, open: thread.id === open });
  }
  return marks.sort((a, b) => a.from - b.from);
}

