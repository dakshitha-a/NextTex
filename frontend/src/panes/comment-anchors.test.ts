import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { CommentThread } from "../api";
import { anchorsFor, likeness, marksFor, placeThread } from "./comment-anchors";

const CHAPTER = "The decay is biexponential, with a fast\ncomponent of 180 fs.\n";

function thread(text: Y.Text, words: string, over: Partial<CommentThread> = {}): CommentThread {
  const at = text.toString().indexOf(words);
  return {
    id: "c1", file_id: "f", path: "main.tex", quote: words, line: 1, detached: false,
    created: 0, resolved: {}, messages: [], ...anchorsFor(text, at, at + words.length), ...over,
  };
}

describe("a comment's place in the text", () => {
  it("is where it was made", () => {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, CHAPTER);
    const made = thread(text, "180 fs");
    expect(placeThread(made, text)).toEqual({ from: CHAPTER.indexOf("180 fs"), to: CHAPTER.indexOf("180 fs") + 6 });
  });

  it("moves with an edit before it, and typing at its edges stays outside it", () => {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, CHAPTER);
    const made = thread(text, "180 fs");
    text.insert(0, "New line.\n");
    const at = CHAPTER.indexOf("180 fs") + 10;
    text.insert(at, "[");
    text.insert(at + 7, "]");
    expect(placeThread(made, text)).toEqual({ from: at + 1, to: at + 7 });
    expect(text.toString().slice(at, at + 8)).toBe("[180 fs]");
  });

  it("is gone when its text is deleted", () => {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, CHAPTER);
    const made = thread(text, "180 fs");
    text.delete(CHAPTER.indexOf("180 fs"), 6);
    expect(placeThread(made, text)).toBeNull();
  });

  it("belongs to one document, and another's anchors place nothing", () => {
    const one = new Y.Doc().getText("text");
    one.insert(0, CHAPTER);
    const other = new Y.Doc().getText("text");
    other.insert(0, CHAPTER);
    expect(placeThread(thread(one, "180 fs"), other)).toBeNull();
  });

  it("is not drawn once resolved, or on another file", () => {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, CHAPTER);
    const open = thread(text, "180 fs", { id: "a" });
    const done = thread(text, "decay", { id: "b", resolved: { at: 1 } });
    const elsewhere = thread(text, "fast", { id: "c", path: "other.tex" });
    expect(marksFor([open, done, elsewhere], "main.tex", text, "a").map((m) => [m.id, m.open]))
      .toEqual([["a", true]]);
  });
});

/** Q-054: a paragraph replaced outside NextTex is folded in letter by
 *  letter, and a thread's anchors can land on two letters the old and new
 *  text share. The range then holds little of its quote and counts as
 *  gone, the way deleting the text does; a rewording keeps it. */
describe("a comment whose text was replaced", () => {
  const PARA = "The method converges quickly on every test case.";

  function commented() {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, PARA);
    return { text, made: thread(text, "converges quickly") };
  }

  it("keeps a rewording", () => {
    const { text, made } = commented();
    const at = PARA.indexOf("quickly");
    text.delete(at, "quick".length);
    text.insert(at, "slow");
    expect(placeThread(made, text)).not.toBeNull();
  });

  it("lets go of two stray letters", () => {
    const { text, made } = commented();
    const start = PARA.indexOf("converges quickly");
    // What a character diff leaves: everything but the last two letters
    // of the range replaced, the range's edges holding to "ly".
    text.delete(start, "converges quick".length);
    text.insert(start, "An entire");
    expect(text.toString()).toContain("An entirely");
    expect(placeThread(made, text)).toBeNull();
  });

  it("measures likeness the way the server does", () => {
    expect(likeness("converges quickly", "converges slowly")).toBeGreaterThan(0.5);
    expect(likeness("converges quickly", "ly")).toBeLessThan(0.5);
    expect(likeness("same", "same")).toBe(1);
  });
});
