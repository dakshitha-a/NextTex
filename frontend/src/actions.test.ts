import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, CHORDED, actionFor, matchesChord, type KeyLike } from "./actions";

/** The registry, and the README's table held to it.
 *
 *  The README's Keyboard section carried the chords by hand and drifted
 *  from the effects that answered them; the Tutorial's list was a third
 *  copy.  The Tutorial renders from the registry now, and this reads the
 *  README's "Anywhere" table back and asserts the two name the same
 *  chords, so the third copy cannot drift without a test saying so.
 */

const press = (over: Partial<KeyLike>): KeyLike => ({
  key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over,
});

describe("matching a chord", () => {
  it("reads Mod as Meta on a Mac and Ctrl elsewhere", () => {
    expect(matchesChord(press({ key: "s", code: "KeyS", metaKey: true }), "Mod-S")).toBe(true);
    expect(matchesChord(press({ key: "s", code: "KeyS", ctrlKey: true }), "Mod-S")).toBe(true);
    expect(matchesChord(press({ key: "s", code: "KeyS" }), "Mod-S")).toBe(false);
  });

  it("matches a letter on the code, so Alt on a Mac cannot hide it", () => {
    // macOS reports the character Alt-A would type.
    expect(matchesChord(press({ key: "å", code: "KeyA", metaKey: true, altKey: true }), "Mod-Alt-A")).toBe(true);
    expect(matchesChord(press({ key: "a", code: "KeyA", ctrlKey: true, altKey: true }), "Mod-Alt-A")).toBe(true);
  });

  it("holds every modifier the chord names, and refuses one it does not", () => {
    expect(matchesChord(press({ key: "T", code: "KeyT", ctrlKey: true, altKey: true, shiftKey: true }), "Mod-Alt-Shift-T")).toBe(true);
    expect(matchesChord(press({ key: "t", code: "KeyT", ctrlKey: true, altKey: true }), "Mod-Alt-Shift-T")).toBe(false);
    expect(matchesChord(press({ key: "T", code: "KeyT", ctrlKey: true, altKey: true, shiftKey: true }), "Mod-Alt-W")).toBe(false);
  });

  it("knows the brackets, the function keys and Enter", () => {
    expect(matchesChord(press({ key: "]", code: "BracketRight", ctrlKey: true, altKey: true }), "Mod-Alt-]")).toBe(true);
    expect(matchesChord(press({ key: "F8", code: "F8" }), "F8")).toBe(true);
    expect(matchesChord(press({ key: "F8", code: "F8", shiftKey: true }), "Shift-F8")).toBe(true);
    expect(matchesChord(press({ key: "F8", code: "F8", shiftKey: true }), "F8")).toBe(false);
    expect(matchesChord(press({ key: "Enter", code: "Enter", metaKey: true }), "Mod-Enter")).toBe(true);
  });

  it("names the action a keydown asks for, and nothing for a plain key", () => {
    expect(actionFor(press({ key: "k", code: "KeyK", ctrlKey: true }))?.id).toBe("palette");
    expect(actionFor(press({ key: "[", code: "BracketLeft", ctrlKey: true, altKey: true }))?.id).toBe("previous-tab");
    expect(actionFor(press({ key: "a", code: "KeyA" }))).toBeNull();
  });
});

describe("the registry", () => {
  it("has one id per action and one chord per chord", () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = CHORDED.map((action) => action.chord);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("names the same chords as the README's tables", () => {
    const readme = readFileSync(join(__dirname, "..", "..", "README.md"), "utf8");
    const table = (from: string, to: string) => {
      const section = readme.split(from)[1].split(to)[0];
      const named = new Set<string>();
      for (const line of section.split("\n")) {
        if (!line.startsWith("|")) continue;
        const cell = line.split("|")[1] ?? "";
        for (const match of cell.matchAll(/`([^`]+)`/g)) {
          const raw = match[1];
          // The Windows spelling of each chord; the Mac glyphs are the
          // same key and are skipped, as is a bare punctuation mark.
          if (!/^(?:Ctrl-|Shift-|F\d)/.test(raw)) continue;
          named.add(raw.replace(/^Ctrl-/, "Mod-").replace("↵", "Enter"));
        }
      }
      return named;
    };
    // Anywhere: the two lists are the same list.
    const anywhere = table("### Anywhere", "### In the source");
    expect([...anywhere].sort()).toEqual([...CHORDED.map((action) => action.chord!)].sort());
    // In the source: the table also holds CodeMirror's own keys, so the
    // registry's rows that belong there must be in it, not the reverse.
    const source = table("### In the source", "### On the page");
    for (const action of ACTIONS) {
      if (action.chord && action.where === "source") expect(source).toContain(action.chord);
    }
  });
});
