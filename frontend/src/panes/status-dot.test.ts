import { describe, expect, test } from "vitest";
import { statusFor, type StatusInput, referencesPending } from "./status-dot";

/** The nine rows, and the tiebreaks between them.
 *
 *  Worth testing as a pure function because the interesting cases are the
 *  ones nobody thinks to click through: a build that timed out, a build
 *  LaTeX aborted without giving a line, a keystroke made while a build was
 *  already running.
 */
const REST: StatusInput = {
  compiling: false,
  slow: false,
  stale: false,
  result: null,
  errors: 0,
  warnings: 0,
  autocompile: true,
};

const at = (patch: Partial<StatusInput>) => statusFor({ ...REST, ...patch });
const built = { durationMs: 1060, outcome: "ok" as const };

describe("the status dot", () => {
  test("says nothing before the first build", () => {
    const dot = at({});
    expect(dot.state).toBe("ready");
    expect(dot.dot).toContain("border");
  });

  test("is green and quiet when the preview matches the source", () => {
    const dot = at({ result: built });
    expect(dot.state).toBe("built");
    expect(dot.dot).toBe("bg-ok");
    expect(dot.label).toBe("Built 1.06s");
  });

  test("goes yellow the moment anything is edited", () => {
    const dot = at({ result: built, stale: true });
    expect(dot.state).toBe("stale");
    expect(dot.dot).toBe("bg-warn");
  });

  test("keeps the same yellow while the build runs, so nothing flickers", () => {
    // The whole point of the scheme: green -> yellow -> green is two colour
    // changes per build, and the dot never moves on an ordinary one.
    const typing = at({ result: built, stale: true });
    const building = at({ result: built, compiling: true });
    expect(building.dot).toBe(typing.dot);
    expect(building.state).toBe("compiling");
  });

  test("only breathes once a build has been running long enough to notice", () => {
    expect(at({ compiling: true, slow: false }).dot).toBe("bg-warn");
    expect(at({ compiling: true, slow: true }).dot).toBe("nx-breathe");
  });

  test("carries the last build's label over while stale, rather than churning", () => {
    // A label that changed on every keystroke would reflow the strip
    // somebody is typing beside.
    expect(at({ result: built, stale: true, errors: 3 }).label).toBe("3 errors");
    expect(at({ result: built, stale: true, warnings: 2 }).label).toBe("2 warnings");
    expect(at({ result: built, stale: true }).label).toBe("Built 1.06s");
    expect(at({ stale: true }).label).toBe("Not built yet");
  });

  test("warnings no longer colour the dot", () => {
    // They are a fact about the source, and they have the label, the
    // drawer and the gutter to say so.  The dot is about the preview.
    const dot = at({ result: built, warnings: 2 });
    expect(dot.dot).toBe("bg-ok");
    expect(dot.label).toBe("2 warnings");
    expect(dot.clickable).toBe(true);
  });

  test("stale beats every finding, because it is about the preview", () => {
    expect(at({ result: built, stale: true, errors: 3 }).dot).toBe("bg-warn");
  });

  test("a build LaTeX aborted is never green", () => {
    // latexlog cannot always pin a fatal error to a line.  Showing that as
    // a clean build is the worst lie available: the writer goes on typing
    // against a preview of a document that no longer compiles.
    const dot = at({ result: { durationMs: 900, outcome: "errors" }, errors: 0 });
    expect(dot.state).toBe("failed");
    expect(dot.dot).toBe("bg-error");
  });

  test("a timed-out or failed build says so instead of showing a duration", () => {
    expect(at({ result: { durationMs: 60000, outcome: "timeout" } }).state)
      .toBe("timeout");
    expect(at({ result: { durationMs: 10, outcome: "no_engine" } }).state)
      .toBe("failed");
  });

  test("errors win over warnings in the label", () => {
    const dot = at({ result: built, errors: 1, warnings: 9 });
    expect(dot.label).toBe("1 error");
    expect(dot.dot).toBe("bg-error");
  });

  test("with compiling off, being stale says how to get a build", () => {
    expect(at({ stale: true, result: built, autocompile: false }).hint)
      .toContain("⌘S");
    expect(at({ stale: true, result: built, autocompile: true }).hint)
      .not.toContain("⌘S");
  });
});

describe("references that have not settled", () => {
  const fast = { enginePass: "fast" };
  const full = { enginePass: "full" };
  const undefinedRef = [{ message: "Reference `fig:flux' on page 3 undefined" }];
  const clean: { message?: string }[] = [];

  test("a fast pass that left ?? on the page says so", () => {
    expect(referencesPending(fast, undefinedRef)).toBe(true);
  });

  test("a fast pass with nothing unresolved says nothing", () => {
    expect(referencesPending(fast, clean)).toBe(false);
  });

  test("a full pass that still has one is the writer's problem, not the build's", () => {
    // A missing label survives a full build, and "press rebuild" would be
    // advice that cannot work.
    expect(referencesPending(full, undefinedRef)).toBe(false);
  });

  test("nothing built yet says nothing", () => {
    expect(referencesPending(null, undefinedRef)).toBe(false);
  });
});
