import { describe, expect, it } from "vitest";

import { shortcut } from "./keys";

describe("a shortcut for both keyboards", () => {
  it.each([
    ["Mod-S", "⌘S", "Ctrl-S"],
    ["Mod-Alt-A", "⌘⌥A", "Ctrl-Alt-A"],
    ["Mod-Alt-Shift-T", "⌘⌥⇧T", "Ctrl-Alt-Shift-T"],
    ["Mod-Enter", "⌘↵", "Ctrl-↵"],
    ["Mod-Shift-F", "⌘⇧F", "Ctrl-Shift-F"],
    ["Mod-.", "⌘.", "Ctrl-."],
    ["Mod-Alt-[", "⌘⌥[", "Ctrl-Alt-["],
    ["Mod-Alt-ArrowUp", "⌘⌥↑", "Ctrl-Alt-↑"],
    ["F8", "F8", "F8"],
    ["Shift-F8", "⇧F8", "Shift-F8"],
    ["Mod-click", "⌘-click", "Ctrl-click"],
    ["Alt-drag", "⌥-drag", "Alt-drag"],
    ["Shift-Enter", "⇧↵", "Shift-↵"],
    ["Escape", "Esc", "Esc"],
  ])("%s is %s on a Mac and %s elsewhere", (spec, mac, win) => {
    expect(shortcut(spec)).toEqual({ mac, win, both: `${mac} / ${win}` });
  });
});
