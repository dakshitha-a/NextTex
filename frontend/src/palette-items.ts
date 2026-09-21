/** What the command palette lists besides the actions: every setting the
 *  sheet has as a thing to type, and every file in the project.
 *
 *  A setting is one row per value, "Ground: warm", "Editor size: 15",
 *  "Spelling: on", so choosing one is one press and the row says what it
 *  will do; the row that is the current value is marked.  Built from the
 *  same tables the sheet reads, so a ground added there is here.  Pure,
 *  so a vitest can count them.
 */

import {
  EDITOR_GROUNDS, EDITOR_SIZES, EDITOR_WEIGHTS, SCALES, WEIGHT_NAMES,
  type Appearance, type EditorTheme, type Keymap, type SpellingVariety,
} from "./appearance";
import type { TreeNode } from "./api";

export type SettingItem = {
  id: string;
  label: string;
  /** Whether the appearance already says this. */
  current: (look: Appearance) => boolean;
  apply: (look: Appearance) => Appearance;
};

const GROUND_NAMES: Record<EditorTheme, string> = {
  match: "follow the theme", white: "white",
};

export function settingItems(): SettingItem[] {
  const items: SettingItem[] = [];
  for (const theme of ["light", "dark"] as const) {
    items.push({
      id: `theme:${theme}`, label: `Theme: ${theme}`,
      current: (look) => look.theme === theme,
      apply: (look) => ({ ...look, theme }),
    });
  }
  for (const ground of EDITOR_GROUNDS) {
    items.push({
      id: `ground:${ground}`, label: `Editor ground: ${GROUND_NAMES[ground]}`,
      current: (look) => look.editorTheme === ground,
      apply: (look) => ({ ...look, editorTheme: ground }),
    });
  }
  for (const size of EDITOR_SIZES) {
    items.push({
      id: `editor:${size}`, label: `Editor size: ${size}`,
      current: (look) => look.editor === size,
      apply: (look) => ({ ...look, editor: size }),
    });
  }
  for (const scale of SCALES) {
    items.push({
      id: `scale:${scale}`, label: `Interface size: ${scale}%`,
      current: (look) => look.scale === scale,
      apply: (look) => ({ ...look, scale }),
    });
  }
  for (const weight of EDITOR_WEIGHTS) {
    items.push({
      id: `weight:${weight}`, label: `Editor weight: ${WEIGHT_NAMES[weight].toLowerCase()}`,
      current: (look) => look.weight === weight,
      apply: (look) => ({ ...look, weight }),
    });
  }
  for (const syntax of ["subtle", "colour"] as const) {
    items.push({
      id: `syntax:${syntax}`, label: `Syntax: ${syntax}`,
      current: (look) => look.syntax === syntax,
      apply: (look) => ({ ...look, syntax }),
    });
  }
  for (const on of [true, false]) {
    items.push({
      id: `spelling:${on ? "on" : "off"}`, label: `Spelling: ${on ? "on" : "off"}`,
      current: (look) => look.spelling === on,
      apply: (look) => ({ ...look, spelling: on }),
    });
  }
  for (const variety of ["follow", "british", "american"] as SpellingVariety[]) {
    items.push({
      id: `variety:${variety}`,
      label: `Spelling variety: ${variety === "follow" ? "follow the document" : variety}`,
      current: (look) => look.spellingVariety === variety,
      apply: (look) => ({ ...look, spellingVariety: variety }),
    });
  }
  for (const on of [true, false]) {
    items.push({
      id: `hover:${on ? "on" : "off"}`, label: `Hover cards: ${on ? "on" : "off"}`,
      current: (look) => look.hover === on,
      apply: (look) => ({ ...look, hover: on }),
    });
  }
  for (const keymap of ["default", "vim", "emacs"] as Keymap[]) {
    items.push({
      id: `keymap:${keymap}`,
      label: `Keymap: ${keymap === "default" ? "default" : keymap === "vim" ? "Vim" : "Emacs"}`,
      current: (look) => look.keymap === keymap,
      apply: (look) => ({ ...look, keymap }),
    });
  }
  return items;
}

/** Every file in the tree, by path, in the tree's order. */
export function fileItems(tree: TreeNode | null): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.type === "dir") walk(child);
      else out.push(child.path);
    }
  };
  if (tree) walk(tree);
  return out;
}
