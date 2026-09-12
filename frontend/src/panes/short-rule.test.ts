/** R-112: the remembered rule was drawn in the protocol's vocabulary. */
import { describe, expect, it } from "vitest";
import { shortRule } from "./short-rule";

describe("what an always-allow answer remembers", () => {
  it("says what a command rule covers, rather than naming a tool", () => {
    expect(shortRule("Bash:latexmk")).toBe(
      "shell commands starting with latexmk",
    );
  });

  it("keeps the end of a path, which is the part being agreed to", () => {
    expect(shortRule("write:/home/writer/papers/shared.bib")).toBe(
      "changing …/papers/shared.bib",
    );
  });

  it("tells reading apart from changing", () => {
    expect(shortRule("read:/tmp/notes.txt")).toBe("reading /tmp/notes.txt");
  });

  it("does not elide a path that is already short", () => {
    expect(shortRule("read:/tmp/notes.txt")).toContain("/tmp/notes.txt");
  });

  it("says what a bare tool name means", () => {
    expect(shortRule("WebFetch")).toBe("fetching pages from the web");
    expect(shortRule("WebSearch")).toBe("searching the web");
  });

  it("leaves a tool it has no words for as its name", () => {
    // Better a name the writer can look up than a guess at what it does.
    expect(shortRule("mcp__other__thing")).toBe("mcp__other__thing");
  });

  it("survives a command that was never typed", () => {
    expect(shortRule("Bash")).toBe("shell commands");
  });
});
