import { describe, expect, it } from "vitest";

import { whatDidNotLand } from "./upload-report";

const result = (name: string, outcome: string) =>
  ({ name, path: "", outcome }) as any;

describe("what the writer is told about an upload", () => {
  it("says nothing when everything landed", () => {
    expect(
      whatDidNotLand([result("a.png", "written"), result("b.png", "replaced")]),
    ).toBe("");
  });

  it("stays quiet about the files the writer chose to skip", () => {
    // That one is their own answer to the question the card just asked.
    expect(whatDidNotLand([result("a.png", "skipped")])).toBe("");
  });

  it("names a file the server refused", () => {
    // The regression. Both callers read only `written`, so a refused file
    // was simply not there afterwards and nothing said why.
    const said = whatDidNotLand([
      result("figure.png", "written"),
      result("latexmkrc", "refused"),
    ]);
    expect(said).toContain("latexmkrc");
    expect(said).toContain("was refused");
  });

  it("names a file that was too large", () => {
    const said = whatDidNotLand([result("scan.tiff", "too-big")]);
    expect(said).toContain("scan.tiff");
    expect(said).toContain("too large");
  });

  it("reads as a sentence when several went the same way", () => {
    const said = whatDidNotLand([
      result("a", "too-big"),
      result("b", "too-big"),
      result("c", "too-big"),
    ]);
    expect(said).toContain("a, b and c were too large");
  });

  it("reports both kinds at once", () => {
    const said = whatDidNotLand([
      result("latexmkrc", "refused"),
      result("scan.tiff", "too-big"),
    ]);
    expect(said).toContain("latexmkrc");
    expect(said).toContain("scan.tiff");
    expect(said.endsWith(".")).toBe(true);
  });
});
