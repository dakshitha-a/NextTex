/** R-009 and R-008: what order the drawer lists errors in, and what it
 *  remembers about which one you opened. */
import { describe, expect, test } from "vitest";
import { orderRows, rowKey } from "./diagnostic-rows";

const err = (file: string, line: number, message = "boom") =>
  ({ severity: "error", file, line, message });
const warn = (file: string, line: number, message = "overfull") =>
  ({ severity: "warning", file, line, message });

describe("the order of the rows", () => {
  test("errors come before warnings", () => {
    const rows = orderRows([warn("a.tex", 1), err("b.tex", 2)], []);
    expect(rows[0].severity).toBe("error");
  });

  test("the preamble stays above a chapter that sorts before it", () => {
    // The bug. `chapters/one.tex` sorts before `main.tex`, and a broken
    // preamble is what made the chapter complain, so the alphabet put the
    // consequence at the top of the drawer.
    const rows = orderRows([err("main.tex", 5), err("chapters/one.tex", 2)], []);
    expect(rows[0].file).toBe("main.tex");
  });

  test("within a severity, the log's order is kept", () => {
    const rows = orderRows([err("z.tex", 9), err("a.tex", 1), err("m.tex", 4)], []);
    expect(rows.map((r) => r.file)).toEqual(["z.tex", "a.tex", "m.tex"]);
  });

  test("lint rows join the list without reordering the errors", () => {
    const rows = orderRows([err("main.tex", 5)], [warn("main.tex", 1)]);
    expect(rows.map((r) => r.severity)).toEqual(["error", "warning"]);
  });
});

describe("what identifies a row", () => {
  test("is not where it happens to be in the list", () => {
    expect(rowKey(err("main.tex", 5))).toBe(rowKey(err("main.tex", 5)));
  });

  test("tells apart two errors on the same line", () => {
    expect(rowKey(err("main.tex", 5, "one"))).not.toBe(
      rowKey(err("main.tex", 5, "two")),
    );
  });

  test("tells apart the same error in two previewed documents", () => {
    expect(rowKey({ ...err("shared.tex", 5), document: "main.tex" })).not.toBe(
      rowKey({ ...err("shared.tex", 5), document: "supplement.tex" }),
    );
  });

  test("survives a rebuild that reorders the list", () => {
    const before = orderRows([err("a.tex", 1), err("b.tex", 2)], []);
    const after = orderRows([err("b.tex", 2), err("a.tex", 1)], []);
    // The row the writer opened is found by what it is, not by slot 0.
    const opened = rowKey(before[0]);
    expect(after.findIndex((r) => rowKey(r) === opened)).toBe(1);
  });
});
