import { describe, expect, test } from "vitest";
import { foldTools, foldedSentence, type ToolGroup } from "./tool-fold";
import type { ChatItem } from "../store";

/** A run of tool calls reads as one sentence, and what must not fold does
 *  not: a question, an answered card, a run of one. */

const tool = (name: string, summary: string, ms?: number): ChatItem =>
  ({ kind: "tool", id: `${name}:${summary}`, name, summary, ms });

const claude = (text: string): ChatItem =>
  ({ kind: "claude", id: `c:${text}`, text, at: 0, streaming: false } as ChatItem);

const card = (decision?: string) =>
  ({ kind: "permission", id: "p1", tool: "Bash", toolId: "Bash:latexmk", rule: "",
     headline: "Run", detail: "latexmk", consequence: "", decision } as any);

describe("folding", () => {
  test("three consecutive calls are one group with the run's whole time", () => {
    const shown = foldTools([
      tool("Read", "main.tex", 400),
      tool("Grep", "\\cite{stolow", 300),
      tool("Bash", "latexmk -pdf main", 2400),
      claude("Done."),
    ]);
    expect(shown.map((item) => item.kind)).toEqual(["tools", "claude"]);
    const group = shown[0] as ToolGroup;
    expect(group.items).toHaveLength(3);
    expect(group.ms).toBe(3100);
    expect(group.ok).toBe(true);
    expect(foldedSentence(group)).toBe(
      "Read main.tex, searched \\cite{stolow, ran latexmk -pdf main",
    );
  });

  test("a run of one is a row, not a group of one", () => {
    const shown = foldTools([tool("Read", "main.tex"), claude("Hi")]);
    expect(shown.map((item) => item.kind)).toEqual(["tool", "claude"]);
  });

  test("a call with a card, open or answered, never folds", () => {
    const asking = { ...tool("Bash", "latexmk"), card: card() } as ChatItem;
    const answered = { ...tool("Bash", "latexmk"), card: card("allow") } as ChatItem;
    const shown = foldTools([tool("Read", "a"), tool("Read", "b"), asking, tool("Read", "c"), answered, tool("Read", "d")]);
    expect(shown.map((item) => item.kind)).toEqual(["tools", "tool", "tool", "tool", "tool"]);
  });

  test("the time is left unsaid while any call is still running", () => {
    const group = foldTools([tool("Read", "a", 100), tool("Read", "b")])[0] as ToolGroup;
    expect(group.ms).toBeUndefined();
  });

  test("a repeated call keeps its count in the sentence", () => {
    const group = foldTools([
      { ...tool("Grep", "x"), repeats: 2 } as ChatItem,
      tool("Read", "y"),
    ])[0] as ToolGroup;
    expect(foldedSentence(group)).toBe("Searched x ×2, read y");
  });
});
