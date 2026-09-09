import { afterEach, describe, expect, it, vi } from "vitest";

import { forget, keep, recall, recallText } from "./remember";

afterEach(() => {
  // Unstubbed first: a test that replaced localStorage with something that
  // throws has not left a clear() to call.
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const DEFAULTS = { rail: 240, editor: 0.5, chat: 380 };

describe("what the interface remembers", () => {
  it("gives back the default when nothing is stored", () => {
    expect(recall("nexttex.widths.p1", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("merges what is stored over the default", () => {
    // Which is what makes adding a new pane safe: an entry written before
    // it existed still restores the two it knows about.
    keep("nexttex.widths.p1", { rail: 300 });
    expect(recall("nexttex.widths.p1", DEFAULTS)).toEqual({
      rail: 300, editor: 0.5, chat: 380,
    });
  });

  it("treats a corrupt entry as no entry", () => {
    window.localStorage.setItem("nexttex.widths.p1", "{not json");
    expect(recall("nexttex.widths.p1", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("treats an entry of the wrong shape as no entry", () => {
    // A list would have spread into the object as numeric keys, which is a
    // stranger failure than simply not restoring.
    window.localStorage.setItem("nexttex.widths.p1", "[1,2,3]");
    window.localStorage.setItem("nexttex.folded.p1", '"a string"');
    expect(recall("nexttex.widths.p1", DEFAULTS)).toEqual(DEFAULTS);
    expect(recall("nexttex.folded.p1", { rail: false })).toEqual({ rail: false });
  });

  it("survives a browser that refuses to store anything", () => {
    // A private window throws on `setItem` rather than ignoring it, and
    // losing a remembered pane width is not a reason to take the app down.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => keep("nexttex.widths.p1", DEFAULTS)).not.toThrow();
    expect(() => forget("nexttex.widths.p1")).not.toThrow();
    expect(recall("nexttex.widths.p1", DEFAULTS)).toEqual(DEFAULTS);
    expect(recallText("nexttex.lastProject")).toBe("");
  });

  it("keeps and forgets a plain string without quoting it", () => {
    keep("nexttex.lastProject", "abc123");
    expect(window.localStorage.getItem("nexttex.lastProject")).toBe("abc123");
    expect(recallText("nexttex.lastProject")).toBe("abc123");
    forget("nexttex.lastProject");
    expect(recallText("nexttex.lastProject")).toBe("");
  });
});
