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
  test("the agent's own housekeeping does not appear", () => {
    const shown = tidy([tool("ToolSearch", "x"), tool("TodoWrite", "y")]);
    expect(shown).toEqual([]);
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
