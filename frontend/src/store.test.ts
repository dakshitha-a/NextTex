import { describe, expect, test } from "vitest";
import {
  countDiff,
  firstChangedLine,
  get,
  markStale,
  replayTranscript,
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

/** A notice is news; an error is a failure.
 *
 *  The agent emits a `notice` when a permission card has gone ten minutes
 *  without an answer and it has denied on the writer's behalf. Neither the
 *  transcript nor this reducer had a case for the type, so the one moment
 *  the app decides something on the writer's behalf was the one moment it
 *  told them nothing.
 */
describe("a notice reaches the panel and keeps its tone", () => {
  test("a notice event becomes a plain item", () => {
    set({ chat: [] });
    __receive({ type: "notice", message: "NextTex waited 10 minutes and said no." });
    const [only] = get().chat;
    expect(only.kind).toBe("notice");
    expect(only).toMatchObject({ tone: "plain" });
  });

  test("an error event is still red", () => {
    set({ chat: [] });
    __receive({ type: "error", message: "The connection ended." });
    expect(get().chat[0]).toMatchObject({ kind: "notice", tone: "error" });
  });

  test("a replayed notice keeps the tone it was recorded with", () => {
    replayTranscript([
      { kind: "notice", text: "said no", tone: "plain" },
      { kind: "notice", text: "broke", tone: "error" },
    ]);
    expect(get().chat.map((item: any) => item.tone)).toEqual(["plain", "error"]);
  });

  test("a notice recorded before tones existed reads as an error", () => {
    // Every notice in an existing transcript came from an `error` event,
    // so an absent tone is red rather than plain.
    replayTranscript([{ kind: "notice", text: "old" }]);
    expect(get().chat[0]).toMatchObject({ tone: "error" });
  });
});

/** What the agent is doing, taken from the events rather than guessed at.
 *
 *  The panel used to work this out by walking the whole transcript
 *  backwards on every render, which is twenty walks a second while an
 *  answer streams, and it could not tell a call that had finished from one
 *  still running because nothing said a call had finished. A turn that spent
 *  twenty seconds inside one tool showed the same line throughout and read
 *  as a turn that had stopped.
 */
describe("what the agent is doing", () => {
  test("a turn starts with nothing being done", () => {
    __receive({ type: "turn_start", prompt: "go" });
    expect(get().thinking).toBe(true);
    expect(get().activity).toBeNull();
  });

  test("a tool call becomes the activity, and finishing clears it", () => {
    __receive({ type: "turn_start", prompt: "go" });
    __receive({
      type: "tool_use", id: "t1", name: "Read",
      input: { file_path: "chapters/02_theory.tex" },
    });
    expect(get().activity).toMatchObject({
      kind: "tool", id: "t1", name: "Read",
    });
    __receive({ type: "tool_done", id: "t1", name: "Read", ms: 1200, ok: true });
    expect(get().activity).toBeNull();
  });

  test("a completion records how long the call took, on its own row", () => {
    __receive({ type: "turn_start", prompt: "go" });
    __receive({ type: "tool_use", id: "t2", name: "Bash", input: { command: "latexmk" } });
    __receive({ type: "tool_done", id: "t2", name: "Bash", ms: 4300, ok: false });
    const row: any = get().chat.find((item: any) => item.id === "t2");
    expect(row).toMatchObject({ ms: 4300, ok: false });
  });

  test("a completion whose id does not line up still clears the line", () => {
    // The id in the hook is the CLI's and the id on the row is the
    // assistant message's. They are believed to be the same string and that
    // cannot be proved from the SDK, so a mismatch has to cost a duration
    // rather than an activity line that never clears.
    __receive({ type: "turn_start", prompt: "go" });
    __receive({ type: "tool_use", id: "row-id", name: "Grep", input: { pattern: "x" } });
    __receive({ type: "tool_done", id: "other-id", name: "Grep", ms: 90, ok: true });
    expect(get().activity).toBeNull();
  });

  test("thinking is an activity with no text to it", () => {
    __receive({ type: "turn_start", prompt: "go" });
    __receive({ type: "thinking" });
    expect(get().activity).toMatchObject({ kind: "thinking", label: "Thinking" });
    __receive({ type: "thinking_end", ms: 6000 });
    expect(get().activity).toBeNull();
  });

  test("done clears it whatever was happening", () => {
    __receive({ type: "turn_start", prompt: "go" });
    __receive({ type: "tool_use", id: "t3", name: "Read", input: {} });
    __receive({ type: "done", subtype: "success" });
    expect(get().activity).toBeNull();
    expect(get().thinking).toBe(false);
  });
});

/** The model's plan for the turn, which used to be discarded as plumbing. */
describe("the plan for a turn", () => {
  const write = (todos: any[]) =>
    __receive({ type: "tool_use", id: `p${Math.random()}`, name: "TodoWrite", input: { todos } });

  test("a TodoWrite becomes a plan rather than a tool row", () => {
    __receive({ type: "turn_start", prompt: "go" });
    write([
      { content: "Read the theory chapter", status: "completed" },
      { content: "Rewrite the second paragraph", status: "in_progress" },
      { content: "Rebuild and check", status: "pending" },
    ]);
    const plans = get().chat.filter((item: any) => item.kind === "plan");
    expect(plans).toHaveLength(1);
    expect((plans[0] as any).items.map((i: any) => i.state)).toEqual([
      "done", "active", "pending",
    ]);
    expect(get().chat.some((item: any) => item.name === "TodoWrite")).toBe(false);
  });

  test("a revised plan replaces the one on screen", () => {
    __receive({ type: "turn_start", prompt: "go" });
    write([{ content: "One", status: "pending" }]);
    write([
      { content: "One", status: "completed" },
      { content: "Two", status: "in_progress" },
    ]);
    const plans = get().chat.filter((item: any) => item.kind === "plan");
    expect(plans).toHaveLength(1);
    expect((plans[0] as any).items).toHaveLength(2);
  });

  test("the plan belongs to its turn and does not outlive it", () => {
    __receive({ type: "turn_start", prompt: "go" });
    write([{ content: "One", status: "pending" }]);
    __receive({ type: "done", subtype: "success" });
    __receive({ type: "turn_start", prompt: "and again" });
    expect(get().chat.some((item: any) => item.kind === "plan")).toBe(false);
  });

  test("an empty or unrecognised list draws nothing", () => {
    __receive({ type: "turn_start", prompt: "go" });
    write([]);
    write([{ status: "pending" }]);
    expect(get().chat.some((item: any) => item.kind === "plan")).toBe(false);
  });
});
