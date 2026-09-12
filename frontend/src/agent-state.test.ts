/** R-048: what a browser concludes when it comes back mid-turn. */
import { describe, expect, test } from "vitest";
import { afterReconcile } from "./agent-state";

describe("coming back to a turn already in flight", () => {
  test("a running turn this browser did not know about raises the panel", () => {
    // The branch that was a bare return. A reload mid-turn left the panel
    // with no Stop button over a turn that was still going.
    expect(afterReconcile({ busy: true, pending: [] }, false)).toBe("raise");
  });

  test("a running turn the panel already draws is left alone", () => {
    expect(afterReconcile({ busy: true, pending: [] }, true)).toBe("leave");
  });

  test("a turn that ended without the browser hearing is lowered", () => {
    expect(afterReconcile({ busy: false, pending: [] }, true)).toBe("lower");
  });

  test("nothing running and nothing drawn needs nothing", () => {
    expect(afterReconcile({ busy: false, pending: [] }, false)).toBe("leave");
  });

  test("open cards come first, whatever the panel thinks", () => {
    // They are the answerable thing, and reviving them raises the panel on
    // the way past.
    expect(afterReconcile({ busy: true, pending: [{ id: "p1" }] }, false)).toBe("cards");
    expect(afterReconcile({ busy: false, pending: [{ id: "p1" }] }, true)).toBe("cards");
  });

  test("a report with neither field says nothing is happening", () => {
    expect(afterReconcile({}, false)).toBe("leave");
  });
});
