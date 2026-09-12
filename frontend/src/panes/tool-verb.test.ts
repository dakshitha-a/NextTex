/** The panel must not say a thing happened that has not happened.
 *
 *  R-108. Every verb was past tense and the tool row is drawn when the call
 *  arrives rather than when it is permitted, so `Ran echo hello` sat above
 *  a card headed "Run a shell command", and a command the writer denied
 *  kept both rows: `Ran`, then `Denied`, the same command twice, nothing
 *  having run. This review's own live session has one.
 */
import { describe, expect, test } from "vitest";
import { verbFor } from "./tool-verb";
import { summariseTool } from "../store";

describe("the word above a tool row", () => {
  test("is never the past tense while a card is still asking", () => {
    expect(verbFor("Bash", "asking")).toBe("Running");
    expect(verbFor("Write", "asking")).toBe("Writing");
    expect(verbFor("Edit", "asking")).toBe("Editing");
    for (const tool of ["Bash", "Write", "Edit", "MultiEdit"]) {
      expect(verbFor(tool, "asking")).not.toMatch(/^(Ran|Wrote|Edited)$/);
    }
  });

  test("says plainly that a refused call did not run", () => {
    expect(verbFor("Bash", "refused")).toBe("Did not run");
    expect(verbFor("Write", "refused")).toBe("Did not run");
  });

  test("is the past tense once the call has been allowed", () => {
    expect(verbFor("Bash")).toBe("Ran");
    expect(verbFor("Bash", "done")).toBe("Ran");
    expect(verbFor("mcp__nexttex__replace_range")).toBe("Rewrote lines");
  });

  test("falls back to the tool's own name, in both tenses", () => {
    expect(verbFor("mcp__other__do_a_thing")).toBe("do a thing");
    expect(verbFor("mcp__other__do_a_thing", "asking")).toBe("do a thing");
  });

  test("every tool whose past tense is a claim has a present tense", () => {
    // The guard on the table above: a verb added to one and not the other
    // silently reintroduces the bug for that tool.
    const CLAIMS = ["Bash", "Write", "Edit", "MultiEdit", "Glob", "Grep"];
    for (const tool of CLAIMS) {
      expect(verbFor(tool, "asking")).not.toBe(verbFor(tool, "done"));
    }
  });
});

describe("R-074: the range rewrite says what it rewrote", () => {
  test("the row does not claim the writer selected anything", () => {
    // The tool takes from_line and to_line and the model picks them.
    expect(verbFor("mcp__nexttex__replace_range", "done")).toBe("Rewrote lines");
    expect(verbFor("mcp__nexttex__replace_range", "asking")).not.toContain(
      "selected",
    );
  });

  test("the lines are the object of the verb", () => {
    expect(
      summariseTool("mcp__nexttex__replace_range", {
        path: "chapters/one.tex",
        from_line: 3,
        to_line: 5,
      }),
    ).toBe("chapters/one.tex 3 to 5");
  });

  test("one line is still a range", () => {
    expect(
      summariseTool("mcp__nexttex__replace_range", { path: "a.tex", from_line: 7 }),
    ).toBe("a.tex 7 to 7");
  });
});
