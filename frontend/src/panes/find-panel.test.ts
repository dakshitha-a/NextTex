import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

/** What the panel's count walks: the query's cursor, whose values carry
 *  the match's range, and the selection that findNext makes, which is that
 *  range exactly. */
describe("the query's cursor", () => {
  test("yields each match's range", () => {
    const state = EditorState.create({ doc: "a section, a Section, and a section." });
    const query = new SearchQuery({ search: "section" });
    const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
    const found: { from: number; to: number }[] = [];
    for (;;) {
      const step = cursor.next();
      if (step.done) break;
      found.push({ from: step.value.from, to: step.value.to });
    }
    expect(found).toEqual([{ from: 2, to: 9 }, { from: 13, to: 20 }, { from: 28, to: 35 }]);
  });
});
