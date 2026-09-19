import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** `localStorage` is reached through two doors and no others.
 *
 *  `appearance.ts` has `readStored` and `writeStored`, the try/catch that
 *  a private window or a blocked site needs; `remember.ts` is the richer
 *  layer over the same store, with JSON and a `forget`.  Everything else
 *  goes through one of them.  Seven hand-rolled copies of the try/catch
 *  lived in the panes for a while, and two panes had none at all: the
 *  page pane read its mode and zoom in `useState` initialisers, so a
 *  storage that threw took the whole pane down on mount.  A test that
 *  reads the source is what keeps an eighth copy, or a third bare call,
 *  from arriving with the next pane.
 */
const ROOT = join(__dirname);
const DOORS = new Set(["appearance.ts", "remember.ts"]);

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "vendor") continue;
      yield* sources(path);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

describe("browser storage", () => {
  it("is touched only by appearance.ts and remember.ts", () => {
    const offenders: string[] = [];
    for (const path of sources(ROOT)) {
      const name = relative(ROOT, path);
      if (DOORS.has(name)) continue;
      const text = readFileSync(path, "utf8");
      // `sessionStorage` is a different store with a different life, one
      // window's, and `followed.ts` is its one door on purpose.
      if (/localStorage/.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
