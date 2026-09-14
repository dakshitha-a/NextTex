import { beforeEach, describe, expect, it } from "vitest";
import { install, record, reset, snapshot } from "./errors";

describe("the interface's record of its own errors", () => {
  beforeEach(reset);

  it("keeps at most twenty, dropping the oldest", () => {
    for (let index = 0; index < 25; index++) record("error", `e${index}`);
    const kept = snapshot();
    expect(kept).toHaveLength(20);
    expect(kept[0].message).toBe("e5");
    expect(kept[19].message).toBe("e24");
  });

  it("bounds each entry", () => {
    record("api", "m".repeat(5000), "s".repeat(9000));
    const [entry] = snapshot();
    expect(entry.message).toHaveLength(2000);
    expect(entry.stack).toHaveLength(4000);
    expect(entry.at).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it("hands out a copy", () => {
    record("boundary", "one");
    const first = snapshot();
    record("boundary", "two");
    expect(first).toHaveLength(1);
    first[0].message = "changed";
    expect(snapshot()[0].message).toBe("one");
  });

  it("listens for both things a window reports, and can stop", () => {
    const target = new EventTarget();
    const stop = install(target);
    const failure = new Error("planted");
    target.dispatchEvent(
      Object.assign(new Event("error"), { message: "planted", error: failure }),
    );
    target.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("unawaited") }),
    );
    expect(snapshot().map((e) => [e.kind, e.message])).toEqual([
      ["error", "planted"],
      ["rejection", "unawaited"],
    ]);
    expect(snapshot()[0].stack).toContain("planted");
    stop();
    target.dispatchEvent(Object.assign(new Event("error"), { message: "after" }));
    expect(snapshot()).toHaveLength(2);
  });

  it("says something about a rejection that is not an Error", () => {
    const target = new EventTarget();
    install(target);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: 42 }));
    expect(snapshot()[0].message).toBe("42");
  });
});
