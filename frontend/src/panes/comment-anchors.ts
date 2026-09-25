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
  // A range that shares little with the text it was on has lost it: an
  // outside edit that replaced a paragraph is folded in letter by letter,
  // and the anchors can land on two letters the old and new paragraphs
  // happen to share (Q-054). The server applies the same test.
  const quote = thread.quote ?? "";
  if (quote.length >= 3) {
    let held = text.toString().slice(from, to);
    if (quote.length >= MAX_QUOTE) held = held.slice(0, quote.length);
    if (likeness(quote, held) < 0.5) return null;
  }
  return { from, to };
}

/** The server's `MAX_QUOTE`: a longer quote was cut to this. */
const MAX_QUOTE = 400;

/** How alike two strings are, from 0 to 1: the Dice coefficient of their
 *  pairs of adjacent letters, as `likeness` in `server/collab/comments.py`
 *  works it out, so the drawer and the editor agree about a thread. */
export function likeness(one: string, two: string): number {
  const pairs = (text: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const pair = text.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return counts;
  };
  const a = pairs(one);
  const b = pairs(two);
  let total = 0;
  for (const count of a.values()) total += count;
  for (const count of b.values()) total += count;
  if (!total) return one === two ? 1 : 0;
  let shared = 0;
  for (const [pair, count] of a) shared += Math.min(count, b.get(pair) ?? 0);
  return (2 * shared) / total;
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

