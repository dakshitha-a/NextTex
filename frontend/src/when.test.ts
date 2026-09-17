import { describe, expect, it } from "vitest";

import { ago } from "./when";

describe("how long ago, roughly", () => {
  const now = 1_800_000_000_000;
  const at = (secondsAgo: number) => now / 1000 - secondsAgo;

  it("rounds to the band a person would use", () => {
    expect(ago(at(0), now)).toBe("just now");
    expect(ago(at(89), now)).toBe("just now");
    expect(ago(at(240), now)).toBe("4 min ago");
    expect(ago(at(3 * 3600), now)).toBe("3 h ago");
    expect(ago(at(30 * 3600), now)).toBe("yesterday");
    expect(ago(at(12 * 86400), now)).toBe("12 days ago");
  });

  it("does not go negative when the clocks disagree", () => {
    expect(ago(at(-30), now)).toBe("just now");
  });

  it("says nothing about a time that never happened", () => {
    // The registry records 0 for a project that was added and not yet
    // opened; the row supplies its own words for that, not "56 years ago".
    expect(ago(0, now)).toBe("");
  });
});
