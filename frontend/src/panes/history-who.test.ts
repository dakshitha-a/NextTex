import { describe, expect, test } from "vitest";
import { who } from "./History";
import type { Version } from "../api";

/** Whose version is this?
 *
 *  Two fields, and both are needed: `by` is the role -- the person or their
 *  agent -- and `peer` is the install. "you" on a shared project has to mean
 *  you and not your collaborator, and their agent's edits have to read as
 *  theirs rather than as Claude in the abstract.
 */

const version = (extra: Partial<Version> = {}): Version => ({
  at: 0, sha: "x", bytes: 1, by: "you", why: "", op: "edit", label: null,
  ...extra,
});

const ME = "a".repeat(64);
const THEM = "b".repeat(64);

describe("who wrote a version", () => {
  test("a version with no peer was written here", () => {
    // Which is what every version made before a project was shared says,
    // so an old history reads exactly as it did.
    expect(who(version(), ME)).toBe("you");
    expect(who(version({ by: "claude" }), ME)).toBe("Claude");
  });

  test("this install's own versions still say you", () => {
    expect(who(version({ peer: ME }), ME)).toBe("you");
    expect(who(version({ peer: ME, by: "claude" }), ME)).toBe("Claude");
  });

  test("a collaborator's version says their name", () => {
    expect(who(version({ peer: THEM, who: "Priya" }), ME)).toBe("Priya");
  });

  test("their agent's edit is theirs, not Claude in the abstract", () => {
    expect(who(version({ peer: THEM, who: "Priya", by: "claude" }), ME))
      .toBe("Priya's Claude");
  });

  test("a collaborator who never gave a name is still distinguishable", () => {
    // A short prefix of the key rather than nothing: two unnamed peers must
    // not look like one person.
    expect(who(version({ peer: THEM }), ME)).toBe("bbbbbb…");
  });
});
