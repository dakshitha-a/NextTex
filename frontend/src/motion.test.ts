import { describe, expect, it } from "vitest";
import { milliseconds } from "./motion";

describe("milliseconds", () => {
  it("reads a time in either unit, as the minifier may write it", () => {
    expect(milliseconds("140ms")).toBe(140);
    expect(milliseconds(".14s")).toBe(140);
    expect(milliseconds(" 0.18s ")).toBe(180);
  });
  it("gives nothing for what is not a time", () => {
    expect(milliseconds("")).toBeNull();
    expect(milliseconds("fast")).toBeNull();
  });
});
