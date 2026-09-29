/** Two versions of a paragraph, as the merge writes them, found and
 *  chosen in place. */
import { beforeAll, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { conflictBars, conflictsIn, keepBoth, keepOne } from "./conflicts";

beforeAll(() => {
  const empty = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => empty as DOMRect;
});

const MERGED = [
  "Intro.",
  "",
  "% NextTex: two versions of this paragraph were written apart. Keep one. {nexttex-conflict 7f3a91}",
  "% Version from Alice {nexttex-conflict 7f3a91 1}",
  "The cat sat quietly on the mat.",
  "",
  "% Version from Bob {nexttex-conflict 7f3a91 2}",
  "A dog lay on the rug.",
  "",
  "% End of the two versions {nexttex-conflict 7f3a91 end}",
  "End.",
  "",
].join("\n");

function view(text: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc: text, extensions: [conflictBars()] }) });
}

test("a merge's marker lines are read as one conflict with its versions", () => {
  const [conflict, ...rest] = conflictsIn(EditorState.create({ doc: MERGED }));
  expect(rest).toEqual([]);
  expect(conflict.sentence).toBe("Two versions of this paragraph were written apart.");
  expect(conflict.versions.map((v) => v.label)).toEqual(["Version from Alice", "Version from Bob"]);
});

test("keeping one version leaves its text and nothing of the markers", () => {
  const editor = view(MERGED);
  keepOne(editor, conflictsIn(editor.state)[0], 1);
  expect(editor.state.doc.toString()).toBe("Intro.\n\nA dog lay on the rug.\n\nEnd.\n");
  expect(conflictsIn(editor.state)).toEqual([]);
  editor.destroy();
});

test("keeping both removes only the marker lines", () => {
  const editor = view(MERGED);
  keepBoth(editor, conflictsIn(editor.state)[0]);
  expect(editor.state.doc.toString()).toBe(
    "Intro.\n\nThe cat sat quietly on the mat.\n\nA dog lay on the rug.\n\nEnd.\n",
  );
  editor.destroy();
});

test("a deleted version is kept by choosing it, which removes the paragraph", () => {
  const text = MERGED.replace("% Version from Alice {nexttex-conflict 7f3a91 1}\nThe cat sat quietly on the mat.\n\n",
    "% Deleted in the version from Alice {nexttex-conflict 7f3a91 1}\n");
  const editor = view(text);
  const conflict = conflictsIn(editor.state)[0];
  expect(conflict.versions[0].label).toBe("Deleted in the version from Alice");
  keepOne(editor, conflict, 0);
  expect(editor.state.doc.toString()).toBe("Intro.\n\nEnd.\n");
  editor.destroy();
});

test("Markdown's comment form is read the same way", () => {
  const text = MERGED.replace(/^% (.*)$/gm, "<!-- $1 -->");
  expect(conflictsIn(EditorState.create({ doc: text }))[0].versions.map((v) => v.label))
    .toEqual(["Version from Alice", "Version from Bob"]);
});

test("an incomplete or out-of-order set of markers is left as plain text", () => {
  const noEnd = MERGED.replace("% End of the two versions {nexttex-conflict 7f3a91 end}\n", "");
  expect(conflictsIn(EditorState.create({ doc: noEnd }))).toEqual([]);
  const swapped = MERGED.replace("7f3a91 2}", "7f3a91 3}");
  expect(conflictsIn(EditorState.create({ doc: swapped }))).toEqual([]);
});

test("the bar is drawn with its buttons", () => {
  const editor = view(MERGED);
  const dom = editor.dom;
  expect(dom.querySelectorAll("[data-testid=conflict-head]").length).toBe(1);
  expect(dom.querySelectorAll("[data-testid=conflict-keep-this]").length).toBe(2);
  expect(dom.textContent).not.toContain("nexttex-conflict");
  editor.destroy();
});
