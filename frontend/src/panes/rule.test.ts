import { describe, expect, it } from "vitest";
import { shortRule } from "./Chat";

describe("shortRule", () => {
  it("keeps the end of a path, which is the part being agreed to", () => {
    expect(shortRule("write:/home/writer/papers/shared.bib")).toBe(
      "write: …/papers/shared.bib",
    );
  });

  it("does not elide a path that is already short", () => {
    expect(shortRule("read:/tmp/notes.txt")).toBe("read: /tmp/notes.txt");
  });

  it("leaves a command rule exactly as it is", () => {
    // `Bash:latexmk` is already the whole story, and shortening it would
    // hide which command was allowed.
    expect(shortRule("Bash:latexmk")).toBe("Bash:latexmk");
  });

  it("leaves a bare tool name alone", () => {
    expect(shortRule("WebFetch")).toBe("WebFetch");
  });
});
