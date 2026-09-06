import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Read off disk rather than imported: `?raw` hands back what Tailwind has
// already processed, and what is being checked here is what somebody wrote.
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "styles.css"),
  "utf-8",
);

/** Whether the text in this app can actually be read.
 *
 *  This has now been got wrong twice and caught by eye both times, which is
 *  not a method.  The palette is parsed straight out of styles.css and every
 *  pairing the app really uses is measured against WCAG 2.1: 4.5:1 for
 *  ordinary text, 3:1 for anything large or for a border that only has to be
 *  seen rather than read.
 */

function palette(block: string): Record<string, string> {
  const start = CSS.indexOf(block);
  if (start < 0) throw new Error(`no such block in styles.css: ${block}`);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    found[name] = value;
  }
  return found;
}

const LIGHT = palette(":root {");
const DARK = palette(':root[data-theme="dark"] {');

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)
  );
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Which token sits on which, curated from the app rather than generated.
 *
 *  A grep for every `color` and `background` in the same rule invents pairs
 *  that never meet on screen and misses the ones composed across two rules,
 *  so this is a list somebody has to keep -- and having to keep it is the
 *  point: adding a colour means saying where it is allowed to go.
 */
const BODY_TEXT: [string, string][] = [
  ["ink", "surface"],
  ["ink", "surface-2"],
  ["ink", "surface-3"],
  ["ink", "surround"],
  ["ink-2", "surface"],
  ["ink-2", "surface-2"],
  ["ink-2", "surface-3"],
  ["ink-3", "surface"],
  ["ink-3", "surface-2"],
  ["ink-3", "surface-3"],
  ["pen", "surface"],
  ["pen", "surface-2"],
  ["hint", "surface"],
  ["hint", "surface-2"],
  ["error", "surface"],
  ["error", "surface-2"],
  ["warn", "surface"],
  ["warn", "surface-2"],
  ["ok", "surface"],
  ["ok", "surface-2"],
];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("%s theme", (_name, tokens) => {
  test("every token the palette names is defined", () => {
    for (const name of ["ink", "ink-2", "ink-3", "pen", "hint", "error", "warn",
                        "ok", "surround", "surface", "surface-2", "surface-3"]) {
      expect(tokens[name], name).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test.each(BODY_TEXT)("%s on %s is readable", (ink, ground) => {
    const ratio = contrast(tokens[ink], tokens[ground]);
    expect(
      Number(ratio.toFixed(2)),
      `--${ink} on --${ground} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

test("the dark theme redefines every colour the light one names", () => {
  // Only the colours: the derived tokens (--line, the washes, the shadows)
  // are either color-mix over these or deliberately different, and a colour
  // that exists only in one theme is the classic unreadable-artifact bug.
  const colours = [
    "surround", "surface", "surface-2", "surface-3",
    "ink", "ink-2", "ink-3", "pen", "hint", "error", "warn", "ok",
  ];
  for (const name of colours) {
    expect(DARK[name], `--${name} is not redefined for the dark theme`)
      .toBeDefined();
    expect(DARK[name]).not.toBe(LIGHT[name]);
  }
});
