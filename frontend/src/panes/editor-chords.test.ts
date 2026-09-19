/** The app's chords pass through the editor untouched.
 *
 *  The app yields to a key the editor has answered, since the Emacs
 *  keymap's Ctrl-K is a kill and not the palette; so a chord the app
 *  owns must not be one the editor's own keymaps answer. CodeMirror's
 *  default keymap binds Mod-Enter to a blank line, and that binding took
 *  Ctrl-Enter from the script runner, and before the app yielded it put
 *  a blank line under every run. This holds the binding out.
 */
import { beforeAll, expect, test } from "vitest";
import { EditorView } from "@codemirror/view";
import { extensions } from "./editor-setup";
import { remoteMarker } from "../collab";
import { ACTIONS } from "../actions";

beforeAll(() => {
  const empty = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => empty as DOMRect;
});

function editor(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    doc,
    extensions: extensions(() => undefined, () => undefined, { current: remoteMarker }),
  });
}

function press(view: EditorView, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

test("Mod-Enter leaves the document alone and the event unanswered", () => {
  const view = editor("def greet():\n    return 1\n");
  view.dispatch({ selection: { anchor: 5 } });
  const event = press(view, { key: "Enter", code: "Enter", ctrlKey: true });
  expect(view.state.doc.toString()).toBe("def greet():\n    return 1\n");
  expect(event.defaultPrevented).toBe(false);
  view.destroy();
});

test("Mod-Shift-F, as a keyboard reports it, is not the editor's find", () => {
  const view = editor("A line.\n");
  // Shift held, so the key is the capital: that is what a keyboard sends
  // and what keeps this apart from the editor's own Mod-f.
  const event = press(view, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
  expect(event.defaultPrevented).toBe(false);
  expect(view.dom.querySelector(".cm-search")).toBeNull();
  view.destroy();
});

test("the registry names Mod-Enter, so the two lists are about the same key", () => {
  expect(ACTIONS.some((action) => action.chord === "Mod-Enter")).toBe(true);
});
