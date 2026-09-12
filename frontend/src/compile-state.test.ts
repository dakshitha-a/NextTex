/** The way back for a flag raised by one event and lowered by another.
 *
 *  `compile_start` raises `compiling` and only `compile_done` lowers it.
 *  Both are news: the broadcaster keeps no backlog, so a browser hears them
 *  only if it was subscribed at that instant. A stream that dropped between
 *  the two left the strip saying Compiling on a document that had finished
 *  building, with nothing that could ever say otherwise. That is R-001, and
 *  it is the shape the review found ten more times: count the ways the job
 *  can end, and check each one lowers what it raised.
 *
 *  The fourth ending is a read rather than a listen. The stream's first
 *  frame, on every connection and every automatic reconnection, is the
 *  state of every document's build. These are the cases that frame has to
 *  get right.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { get, set, __receive } from "./store";

const RESTING = {
  projectId: "p1",
  activePreview: "main.tex",
  builds: {},
} as never;

function snapshot(rows: Array<Record<string, unknown>>) {
  return { type: "compile_state", documents: rows };
}

describe("the compile state a connection is given", () => {
  beforeEach(() => {
    set(RESTING);
  });

  test("a build nobody saw start is shown as running", () => {
    __receive(snapshot([{ document: "main.tex", compiling: true, build: 4 }]));
    expect(get().builds["main.tex"].compiling).toBe(true);
  });

  test("a build that finished while the stream was down is not still running", () => {
    __receive({ type: "compile_start", build: 7, document: "main.tex" });
    expect(get().builds["main.tex"].compiling).toBe(true);

    // The stream drops here, the build finishes unheard, and the stream
    // comes back. Before this frame existed there was nothing in the world
    // that could lower the flag.
    __receive(snapshot([{ document: "main.tex", compiling: false, build: 7 }]));

    expect(get().builds["main.tex"].compiling).toBe(false);
  });

  test("it says what is running and not what a build produced", () => {
    __receive({
      type: "compile_done", build: 1, document: "main.tex",
      outcome: "ok", diagnostics: [],
    });
    const built = get().builds["main.tex"].result;
    expect(built).not.toBeNull();

    __receive(snapshot([{ document: "main.tex", compiling: false, build: 1 }]));

    expect(get().builds["main.tex"].result).toBe(built);
  });

  test("every document in the project is answered, not only the visible one", () => {
    __receive(snapshot([
      { document: "main.tex", compiling: false, build: 2 },
      { document: "supplement.tex", compiling: true, build: 1 },
    ]));
    expect(get().builds["main.tex"].compiling).toBe(false);
    expect(get().builds["supplement.tex"].compiling).toBe(true);
  });

  test("a done for the build the snapshot named is still the one that counts", () => {
    // The snapshot sets the build number a later `compile_done` is matched
    // against, so a cancelled result for a superseded build does not clear
    // a newer one.
    __receive(snapshot([{ document: "main.tex", compiling: true, build: 9 }]));
    __receive({
      type: "compile_done", build: 8, document: "main.tex", outcome: "cancelled",
    });
    expect(get().builds["main.tex"].compiling).toBe(true);

    __receive({
      type: "compile_done", build: 9, document: "main.tex", outcome: "cancelled",
    });
    expect(get().builds["main.tex"].compiling).toBe(false);
  });
});
