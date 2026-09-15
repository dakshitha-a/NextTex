/** A shortcut written for both keyboards at once.
 *
 *  Every handler in the app reads `metaKey || ctrlKey`, so Cmd on a Mac
 *  and Ctrl everywhere else are the same key to it, and both forms are
 *  true wherever the app runs.  They are shown together, the Mac glyphs
 *  and then the words, rather than one chosen by sniffing the platform:
 *  `navigator.platform` calls an iPad a Mac or not depending on the
 *  version of Safari, and a reader on Windows helping a colleague on a
 *  Mac wants both anyway.  The README's keyboard table is the convention
 *  and this is its one implementation, so the tutorial, a tooltip and the
 *  strip cannot each spell the same key differently.
 *
 *  A spec is written the way CodeMirror writes one: `Mod-Alt-Shift-T`,
 *  `Mod-Enter`, `Shift-F8`, `Mod-click`, `Alt-drag`, `Mod-Alt-ArrowUp`. */

const MAC: Record<string, string> = {
  Mod: "⌘", Alt: "⌥", Shift: "⇧", Enter: "↵", Tab: "↹",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Escape: "Esc",
};

const WIN: Record<string, string> = {
  Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Enter: "↵", Tab: "↹",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Escape: "Esc",
};

const MODIFIERS = new Set(["Mod", "Alt", "Shift"]);
/** Verbs rather than keys: a click or a drag with a modifier held. */
const GESTURES = new Set(["click", "drag", "wheel"]);

export type Shortcut = { mac: string; win: string; both: string };

export function shortcut(spec: string): Shortcut {
  const parts = spec.split("-").filter(Boolean);
  const mac = parts
    .map((part, at) => {
      const glyph = MAC[part] ?? part;
      // Glyphs run together, `⌘⌥⇧T`; a gesture keeps its hyphen, `⌘-click`.
      if (GESTURES.has(part)) return `-${glyph}`;
      return at > 0 && !MODIFIERS.has(parts[at - 1]) ? `-${glyph}` : glyph;
    })
    .join("");
  const win = parts.map((part) => WIN[part] ?? part).join("-");
  return { mac, win, both: `${mac} / ${win}` };
}
