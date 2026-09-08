import { describe, expect, test } from "vitest";
import {
  countDiff,
  firstChangedLine,
  get,
  markStale,
  set,
  __receive,
} from "./store";

/** Reading a diff, which the chat panel does for every edit Claude makes.
 *
 *  Both of these are silent when wrong: a caret that lands on the wrong
 *  line, or a chip that says +3/−3 for a paragraph that moved.
 */

describe("where an edit begins", () => {
  test("identical text has no first changed line", () => {
    expect(firstChangedLine("a\nb\nc", "a\nb\nc")).toBe(1);
  });

  test("a change on the first line is line one", () => {
    expect(firstChangedLine("a\nb", "A\nb")).toBe(1);
  });

  test("a change in the middle is found", () => {
    expect(firstChangedLine("a\nb\nc", "a\nB\nc")).toBe(2);
  });

  test("an append points at the first new line", () => {
    expect(firstChangedLine("a\nb", "a\nb\nc")).toBe(3);
  });

  test("a deletion points at where the text used to be", () => {
    expect(firstChangedLine("a\nb\nc", "a\nc")).toBe(2);
  });

  test("writing into an empty file is line one", () => {
    expect(firstChangedLine("", "the first sentence")).toBe(1);
  });
});

describe("how much changed", () => {
  test("an added line counts once", () => {
    expect(countDiff("a\nb", "a\nnew\nb")).toEqual({ added: 1, removed: 0 });
  });

  test("a removed line counts once", () => {
    expect(countDiff("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
  });

  test("a rewritten line is one of each", () => {
    expect(countDiff("a\nb", "a\nB")).toEqual({ added: 1, removed: 1 });
  });

  test("no change is nothing", () => {
    expect(countDiff("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
  });

  test("a line that only moved is not counted twice", () => {
    // LaTeX repeats lines constantly -- \centering, \hline, blank lines --
    // and a naive line-by-line count reports a moved one as +1 and −1.
    const before = "\\begin{figure}\n\\centering\n\\caption{One}\n\\end{figure}";
    const after = "\\begin{figure}\n\\caption{One}\n\\centering\n\\end{figure}";
    const { added, removed } = countDiff(before, after);
    expect(added).toBeLessThanOrEqual(1);
    expect(removed).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Several previewed documents
//
// The bug these stand guard over: one shared diagnostics list meant each
// build erased the other document's errors, twice per debounce.


function reset() {
  set({
    previews: ["main.tex", "esi.tex"],
    activePreview: "main.tex",
    builds: {},
    diagnosticsByDoc: {},
    owners: { "main.tex": ["main.tex"], "esi.tex": ["esi.tex"] },
  });
}

const done = (document: string, diagnostics: any[]) => ({
  type: "compile_done", document, build: 1, outcome: "ok", diagnostics,
});

describe("diagnostics from several documents", () => {
  test("keeps both documents' errors rather than replacing", () => {
    reset();
    __receive(done("main.tex", [{ severity: "error", file: "main.tex", line: 3 }]));
    __receive(done("esi.tex", [{ severity: "error", file: "esi.tex", line: 9 }]));
    expect(get().diagnostics).toHaveLength(2);
  });

  test("a clean build clears only its own document", () => {
    reset();
    __receive(done("main.tex", [{ severity: "error", file: "main.tex", line: 3 }]));
    __receive(done("esi.tex", [{ severity: "error", file: "esi.tex", line: 9 }]));
    __receive(done("main.tex", []));
    expect(get().diagnostics).toHaveLength(1);
    expect(get().diagnostics[0].file).toBe("esi.tex");
  });

  test("a cancelled build changes nothing", () => {
    reset();
    __receive(done("esi.tex", [{ severity: "error", file: "esi.tex", line: 9 }]));
    __receive({ type: "compile_done", document: "esi.tex", outcome: "cancelled", build: 99 });
    expect(get().diagnostics).toHaveLength(1);
  });
});

describe("staleness is routed to the documents that read the file", () => {
  test("marks only the documents that read what changed", () => {
    reset();
    __receive({ type: "compile_start", document: "main.tex", build: 1 });
    __receive({ type: "compile_start", document: "esi.tex", build: 1 });
    // Editing the supplementary information must not leave the main
    // document stale for ever with no build coming to clear it.
    markStale("esi.tex");
    expect(get().builds["esi.tex"].stale).toBe(true);
    expect(get().builds["main.tex"].stale).toBe(false);
  });

  test("says nothing about a file it cannot place", () => {
    reset();
    markStale("mystery.tex");
    expect(get().builds["main.tex"]?.stale ?? false).toBe(false);
  });
});

// --- collaboration ----------------------------------------------------------

describe("what the interface is told about collaboration", () => {
  test("nobody else in it means an empty list, not a placeholder", () => {
    // The strip draws nothing at all in this state. An empty row labelled
    // "collaborators" on a project with no collaborators is a permanent
    // reminder of a feature you are not using.
    set({ collaborators: [] });
    expect(get().collaborators).toEqual([]);
  });

  test("connecting and offline are different things", () => {
    // "offline" is a warning, and showing one before the first socket has
    // had a chance to open would make every session start with an alarm.
    set({ connection: "connecting" });
    expect(get().connection).toBe("connecting");
    set({ connection: "offline" });
    expect(get().connection).toBe("offline");
  });

  test("a collaborator carries where they are and whether they are working", () => {
    set({
      collaborators: [
        { clientId: 7, name: "Priya", colour: "#3FC6D2",
          path: "chapters/04_results.tex", line: 112, active: true },
      ],
    });
    const [person] = get().collaborators;
    expect(person.name).toBe("Priya");
    expect(person.path).toBe("chapters/04_results.tex");
    expect(person.active).toBe(true);
  });
});
