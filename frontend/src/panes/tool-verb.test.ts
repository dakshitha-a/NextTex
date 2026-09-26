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

describe("ChatGPT's calls", () => {
  test("arrive without the prefix and read as Claude's do", () => {
    // The OpenAI provider names the app's own tools bare, so every one of
    // its rows read as the tool's own name with the underscores taken out.
    expect(verbFor("show_page")).toBe("Turned the preview to a page");
    expect(verbFor("install_package", "asking")).toBe("Installing a package");
    expect(verbFor("list_files")).toBe("list files");
  });
});

describe("the agent's comment tools", () => {
  test("read as the direction page draws them, folded with what they were done to", () => {
    expect(verbFor("mcp__nexttex__list_comments")).toBe("Read the comments");
    expect(verbFor("mcp__nexttex__reply_to_comment")).toBe("Replied to a comment");
    // The reply writes into a thread everybody sees, so it is not in the
    // past tense while it is still being asked about.
    expect(verbFor("mcp__nexttex__reply_to_comment", "asking")).toBe("Replying to a comment");
  });

  test("and ChatGPT's calls, which arrive without the prefix, read the same", () => {
    // The OpenAI provider names its tools bare, so every one of its rows
    // read as the tool's own name with the underscores taken out.
    expect(verbFor("list_comments")).toBe("Read the comments");
    expect(verbFor("reply_to_comment", "asking")).toBe("Replying to a comment");
  });
});
