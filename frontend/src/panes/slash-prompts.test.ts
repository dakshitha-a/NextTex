import { describe, expect, it } from "vitest";
import { alreadyNamed, completed, matching, slashHead, type PromptEntry } from "./slash-prompts";

const PROMPTS: PromptEntry[] = [
  { name: "review-critical", said: "review critical", source: "builtin", hint: "Read as the second reviewer.", text: "..." },
  { name: "review-friendly", said: "review friendly", source: "builtin", hint: "Read as a mentor.", text: "..." },
  { name: "tighten", said: "tighten", source: "project", hint: "Tighten this.", text: "..." },
];

describe("a slash command being typed", () => {
  it("is a first line starting with a slash", () => {
    expect(slashHead("/rev")).toBe("rev");
    expect(slashHead("/")).toBe("");
    expect(slashHead("rev")).toBeNull();
    expect(slashHead("/review friendly\nand a note")).toBeNull();
  });

  it("lists every prompt on a bare slash and narrows as letters arrive", () => {
    expect(matching("/", PROMPTS).map((p) => p.name)).toEqual(["review-critical", "review-friendly", "tighten"]);
    expect(matching("/rev", PROMPTS).map((p) => p.name)).toEqual(["review-critical", "review-friendly"]);
    expect(matching("/review f", PROMPTS).map((p) => p.name)).toEqual(["review-friendly"]);
    expect(matching("/Review-F", PROMPTS).map((p) => p.name)).toEqual(["review-friendly"]);
    expect(matching("/frob", PROMPTS)).toEqual([]);
    expect(matching("no slash", PROMPTS)).toEqual([]);
  });

  it("completes to the spoken name with a space for the note", () => {
    expect(completed(PROMPTS[1])).toBe("/review friendly ");
  });

  it("knows when the draft already is a name, even beside a longer one", () => {
    const withShort: PromptEntry[] = [
      { name: "review", said: "review", source: "project", hint: "Just review.", text: "..." },
      ...PROMPTS,
    ];
    // Two rows stay up on `/review `, and the draft is one of them: Enter
    // must send, not fill the first in again.
    const offered = matching("/review ", withShort);
    expect(offered.map((p) => p.name)).toEqual(["review", "review-critical", "review-friendly"]);
    expect(alreadyNamed("/review ", offered)).toBe(true);
    expect(alreadyNamed("/Review-Friendly", offered)).toBe(true);
    expect(alreadyNamed("/rev", matching("/rev", withShort))).toBe(false);
    expect(alreadyNamed("/review friendly the abstract", [])).toBe(false);
  });
});
