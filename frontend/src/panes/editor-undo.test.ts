/** Which undo stack owns Ctrl+Z in a live editor.
 *
 *  A buffer is built from `opened.text.toString()` before the file's socket
 *  has synced, so for a file nobody has open the whole document arrives
 *  afterwards as one remote transaction.  If CodeMirror's own `history()`
 *  is in the live editor's extensions, that transaction is on its undo
 *  stack, and a few presses of Ctrl+Z empty the file.  The write goes to
 *  the shared document, so it reaches disk and every other browser.
 *
 *  The scoped `Y.UndoManager` that `collab.ts` builds is the right owner:
 *  it tracks only what this keyboard typed.  These tests hold the two
 *  halves of that apart, which is R-029.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { extensions } from "./editor-setup";
import { remoteMarker } from "../collab";

// jsdom has no layout, and CodeMirror measures its text in an animation
// frame after the state is built. Without these the measurement throws
// asynchronously, long after the assertion has been made, and the failure
// lands on whichever test happens to be running. Nothing here is measured.
beforeAll(() => {
  const empty = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => empty as DOMRect;
});

const CHAPTER = [
  "\\documentclass{article}",
  "\\begin{document}",
  "A paragraph that was already in the file.",
  "\\end{document}",
  "",
].join("\n");

/** A live editor on an empty document, the way `Editor.tsx` builds one
 *  before the socket has answered. */
function liveEditor() {
  const doc = new Y.Doc();
  const text = doc.getText("text");
  const undo = new Y.UndoManager(text, {
    trackedOrigins: new Set([null, undefined]),
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    doc: text.toString(),
    extensions: [
      ...extensions(
        () => undefined,
        () => undefined,
        () => null,
        { current: remoteMarker },
      ),
      yCollab(text, null, { undoManager: undo }),
      keymap.of(yUndoManagerKeymap),
    ],
  });
  return { doc, text, view };
}

/** What the socket does when the first sync lands: `readSyncMessage` is
 *  given the socket as the transaction origin, so this is not `null`. */
function arrivesFromTheSocket(doc: Y.Doc, body: string) {
  const sender = new Y.Doc();
  sender.getText("text").insert(0, body);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sender), { theSocket: true });
}

function pressUndo(view: EditorView) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    ctrlKey: true,
    bubbles: true,
  });
  runScopeHandlers(view, event, "editor");
}

describe("undo in a live editor", () => {
  test("the file arriving from the socket is not something to undo", () => {
    const { doc, text, view } = liveEditor();
    arrivesFromTheSocket(doc, CHAPTER);
    expect(view.state.doc.toString()).toBe(CHAPTER);

    for (let press = 0; press < 6; press += 1) pressUndo(view);

    expect(text.toString()).toBe(CHAPTER);
    expect(view.state.doc.toString()).toBe(CHAPTER);
    view.destroy();
  });

  test("what this keyboard typed is still undone", () => {
    const { doc, text, view } = liveEditor();
    arrivesFromTheSocket(doc, CHAPTER);
    const at = CHAPTER.indexOf("A paragraph");
    view.dispatch({ changes: { from: at, insert: "Once more: " } });
    expect(text.toString()).toContain("Once more: A paragraph");

    pressUndo(view);

    expect(text.toString()).toBe(CHAPTER);
    view.destroy();
  });

  test("undo never reaches past the start of the shared document", () => {
    const { doc, text, view } = liveEditor();
    arrivesFromTheSocket(doc, CHAPTER);
    view.dispatch({ changes: { from: 0, insert: "% a note\n" } });

    for (let press = 0; press < 12; press += 1) pressUndo(view);

    expect(text.toString()).toBe(CHAPTER);
    expect(text.toString()).toContain("\\documentclass");
    view.destroy();
  });
});
