/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";

import { Followed } from "./followed";

describe("the followed set, across a reload", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("remembers per project and comes back after a reload", () => {
    const first = new Followed();
    first.load("p1");
    first.add("esi.tex");
    first.add("notes.tex");
    first.delete("notes.tex");
    // A reload is a new instance reading the same window's storage.
    const again = new Followed();
    again.load("p1");
    expect([...again]).toEqual(["esi.tex"]);
    // And another project has its own memory.
    again.load("p2");
    expect([...again]).toEqual([]);
    again.load("p1");
    expect(again.has("esi.tex")).toBe(true);
  });

  it("keeps only what is still on the strip, and follows a rename", () => {
    const set = new Followed();
    set.load("p1");
    set.add("a.tex");
    set.add("b.tex");
    set.retain(["b.tex"]);
    set.rename("b.tex", "c.tex");
    const again = new Followed();
    again.load("p1");
    expect([...again]).toEqual(["c.tex"]);
  });

  it("ignores storage it cannot read and works without any", () => {
    window.sessionStorage.setItem("nexttex.followed.p1", "{not json");
    const set = new Followed();
    set.load("p1");
    expect([...set]).toEqual([]);
    window.sessionStorage.setItem("nexttex.followed.p1", JSON.stringify(["x.tex", 3]));
    set.load("p1");
    expect([...set]).toEqual(["x.tex"]);
    set.load(null);
    set.add("y.tex");
    expect(set.has("y.tex")).toBe(true);
  });
});
