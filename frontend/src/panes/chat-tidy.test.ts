import { describe, expect, test } from "vitest";
import { tidy } from "./Chat";
import type { ChatItem } from "../store";

/** What the conversation shows, out of what the agent actually did.
 *
 *  A turn produces a lot of bookkeeping -- searches for its own tools, a
 *  Read before every Edit, the same grep four times -- and showing all of
 *  it turns the panel into a log.  What is dropped here is dropped for the
 *  reader's sake, so each rule needs to stay exactly as narrow as it is.
 */

const tool = (name: string, summary: string): ChatItem =>
  ({ kind: "tool", id: `${name}:${summary}:${Math.random()}`, name, summary });

const edit = (path: string): ChatItem =>
  ({ kind: "edit", id: `e${Math.random()}`, path, before: "a", after: "b",
     added: 1, removed: 1, state: "live" });

describe("what is hidden", () => {
  test("looking up its own tools does not appear", () => {
    expect(tidy([tool("ToolSearch", "x")])).toEqual([]);
  });

  // This used to hide `TodoWrite` as well, on the grounds that it was
  // housekeeping. It is not: it is the model saying what it intends to do
  // next, which is the clearest thing the panel can show about a turn that
  // will run for a minute. It no longer reaches this function at all --
  // the store takes it and makes the turn's plan out of it -- so if one
  // ever does arrive here it should be shown rather than swallowed.
  test("the model's plan for the turn is not housekeeping", () => {
    expect(tidy([tool("TodoWrite", "y")])).toHaveLength(1);
  });

  test("everything else does", () => {
    expect(tidy([tool("Read", "main.tex")])).toHaveLength(1);
  });
});

describe("what is collapsed", () => {
  test("the same call four times over is shown once, with a count", () => {
    const shown = tidy([
      tool("Grep", "\\cite"), tool("Grep", "\\cite"),
      tool("Grep", "\\cite"), tool("Grep", "\\cite"),
    ]);
    expect(shown).toHaveLength(1);
    expect((shown[0] as any).repeats).toBe(4);
  });

  test("two calls with something between them are two calls", () => {
    const shown = tidy([
      tool("Grep", "\\cite"), tool("Read", "main.tex"), tool("Grep", "\\cite"),
    ]);
    expect(shown).toHaveLength(3);
  });

  test("the same tool on different files is not collapsed", () => {
    expect(tidy([tool("Read", "a.tex"), tool("Read", "b.tex")])).toHaveLength(2);
  });
});

describe("an edit and the tool row that announced it", () => {
  test("the row is swallowed by the chip that carries the diff", () => {
    const shown = tidy([tool("Edit", "chapters/one.tex"), edit("chapters/one.tex")]);
    expect(shown).toHaveLength(1);
    expect(shown[0].kind).toBe("edit");
  });

  test("a row for a different file is not swallowed", () => {
    // The near miss that matters: `one.tex` is a suffix of
    // `chapters/one.tex`, so a careless endsWith eats the wrong row.
    const shown = tidy([tool("Edit", "one.tex"), edit("chapters/one.tex")]);
    expect(shown).toHaveLength(2);
  });

  test("a Read before an edit stays, because it is not the same act", () => {
    const shown = tidy([tool("Read", "one.tex"), edit("one.tex")]);
    expect(shown).toHaveLength(2);
  });
});

describe("what a collapsed row costs", () => {
  test("repeated calls sum their durations rather than keeping the first", () => {
    const shown = tidy([
      { kind: "tool", id: "a", name: "Read", summary: "main.tex", ms: 300 },
      { kind: "tool", id: "b", name: "Read", summary: "main.tex", ms: 400 },
      { kind: "tool", id: "c", name: "Read", summary: "main.tex", ms: 500 },
    ]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ repeats: 3, ms: 1200 });
  });

  test("a row with no duration at all keeps none", () => {
    const shown = tidy([tool("Read", "x"), tool("Read", "x")]);
    expect(shown[0]).toMatchObject({ repeats: 2, ms: undefined });
  });

  test("one failure in a collapsed row is a failed row", () => {
    const shown = tidy([
      { kind: "tool", id: "a", name: "Bash", summary: "latexmk", ok: true },
      { kind: "tool", id: "b", name: "Bash", summary: "latexmk", ok: false },
    ]);
    expect(shown[0]).toMatchObject({ repeats: 2, ok: false });
  });
});

/** Records collapse; questions never do.
 *
 *  A turn at one of the quiet positions writes a row for every action it
 *  took, and at the quietest one that record is the only account of what was
 *  done, so forty identical "Allowed automatically" lines are both the audit
 *  trail working and unreadable.
 */
const card = (over: Partial<Extract<ChatItem, { kind: "permission" }>> = {}) =>
  ({
    kind: "permission", id: `p${Math.random()}`, tool: "Bash", rule: "Bash:latexmk",
    headline: "Run a shell command", detail: "latexmk -pdf main.tex",
    consequence: "", reason: "", at: 0, ...over,
  }) as ChatItem;

describe("collapsing the record", () => {
  test("identical automatic approvals become one row with a count", () => {
    const shown = tidy([
      card({ decision: "auto" }),
      card({ decision: "auto" }),
      card({ decision: "auto" }),
    ]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ repeats: 3 });
  });

  test("a question is never folded into another question", () => {
    // Two cards waiting for an answer are two answers the writer owes, and
    // one row with a count would be one press for both.
    const shown = tidy([card(), card()]);
    expect(shown).toHaveLength(2);
  });

  test("a different command is a different row", () => {
    const shown = tidy([
      card({ decision: "auto" }),
      card({ decision: "auto", detail: "biber main" }),
    ]);
    expect(shown).toHaveLength(2);
  });

  test("an approval and a refusal do not collapse into each other", () => {
    const shown = tidy([
      card({ decision: "auto" }),
      card({ decision: "deny" }),
    ]);
    expect(shown).toHaveLength(2);
  });

  test("a run broken by something else does not fold across it", () => {
    const shown = tidy([
      card({ decision: "auto" }),
      tool("Read", "main.tex"),
      card({ decision: "auto" }),
    ]);
    expect(shown).toHaveLength(3);
  });
});
