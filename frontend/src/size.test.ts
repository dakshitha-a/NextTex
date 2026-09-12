import { describe, expect, it } from "vitest";
import { sizeOf } from "./size";

describe("sizeOf", () => {
  it("counts small things in bytes", () => {
    expect(sizeOf(0)).toBe("0 B");
    expect(sizeOf(1023)).toBe("1023 B");
  });

  it("rounds kilobytes rather than showing a decimal nobody reads", () => {
    expect(sizeOf(1024)).toBe("1 KB");
    expect(sizeOf(1024 * 40 + 300)).toBe("40 KB");
  });

  it("keeps one decimal for megabytes, where it is the difference", () => {
    expect(sizeOf(1024 * 1024)).toBe("1.0 MB");
    expect(sizeOf(1024 * 1024 * 3.75)).toBe("3.8 MB");
  });

  it("says nothing rather than something wrong for a number that is not one", () => {
    // The server can answer with a count it could not take, and "NaN B"
    // beside a destructive action is worse than a blank.
    expect(sizeOf(Number.NaN)).toBe("");
    expect(sizeOf(-1)).toBe("");
  });
});
