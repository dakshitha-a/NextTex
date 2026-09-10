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

// The class half of each selector, because the palettes are now shared
// with the editor's own light/dark scope and `:root` alone no longer ends
// a selector.  Same block, same declarations.
const LIGHT = palette(".nx-theme-light {");
const DARK = palette(".nx-theme-dark {");

/** The three paper grounds, composed the way the browser composes them.
 *
 *  Each is applied *together with* `.nx-theme-light` and moves only the four
 *  surfaces, so measuring the block on its own would measure four hexes in
 *  isolation and certify nothing.  Spreading it over the light palette is
 *  what a writer actually looks at.  They are listed here rather than left
 *  out because the failure this file exists to prevent is a palette nobody
 *  measured: a block the test was never told about is not caught by the
 *  `no such block` throw, it is simply never checked. */
const ground = (block: string) => ({ ...LIGHT, ...palette(block) });
const WHITE = ground(".nx-theme-white {");
const WARM = ground(".nx-theme-warm {");
const COOL = ground(".nx-theme-cool {");

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
  // --surround is a darker ground than the three surfaces, and it was only
  // ever certified for --ink.  The projects screen puts small text on it,
  // and --ink-3 measures 4.17:1 there -- under the 4.5 small text needs,
  // and missed for exactly as long as this list omitted the pairing.  So
  // --ink-2 is certified here and --ink-3 is deliberately absent: the
  // `.nx-on-surround` rule in styles.css steps it up rather than allowing
  // the pairing, and adding it back below would fail this test, which is
  // the intended way to find out.
  ["ink-2", "surround"],
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
  // A filled --pen button writes its label in --on-pen.  White on the light
  // violet, near-black on the pale dark one; the token exists so the button
  // asks the palette in force rather than the root's theme, which is the
  // wrong question inside the light theme's dark furniture.
  ["on-pen", "pen"],
];

/** The five command families, which have to be told apart from one another
 *  as well as read against the page. */
const SYNTAX = ["syn-structure", "syn-env", "syn-math", "syn-preamble", "syn-cite"];

/** The one pairing in this file that is deliberately held to 4:1 rather than
 *  4.5:1, and the reasoning has to survive being read by somebody who did not
 *  agree to it.
 *
 *  On a light page, pop and contrast pull against each other, and not as a
 *  matter of taste: sRGB holds the most chroma at a lightness well above the
 *  one that maximises contrast, so every step toward a colour whose hue you
 *  can actually see is a step down in ratio.  Two palettes were shipped that
 *  kept 4.5:1 comfortably -- 5.7:1, then 7.0:1 -- and the writer's verdict on
 *  both was that the colours melted into the prose.  They were right, and the
 *  ratio is why: raising contrast on a light page means going darker, and
 *  darker means closer to the near-black the prose is set in.
 *
 *  So the families were chosen by looking at five candidates rendered as real
 *  source on all four light pages, and the one chosen measures 4.1 to 4.9:1
 *  on the proofing grey and 4.8 to 6.1:1 on the three papers.  Three things
 *  make that a trade worth taking here and nowhere else in this file:
 *
 *  - Colouring is off by default and stays off until somebody asks for it.
 *    Nobody is given this without choosing it.
 *  - It is never the only carrier.  A control sequence is set 200 weights
 *    above the prose whatever this setting says, so with the colour removed
 *    entirely -- by the setting, by a display, by a person who cannot see
 *    the hue -- the structure of the file is still legible.  That is the
 *    condition WCAG actually asks for, and it is met.
 *  - It applies to control sequences, which are five to fifteen characters
 *    of fixed vocabulary, not to running prose.  --ink on --surface is
 *    still 14.4:1 and nothing here touches it.
 *
 *  4:1 rather than no floor at all, because the point is to keep the next
 *  change honest: this is a stated, measured departure, not permission to
 *  drift. */
const SYNTAX_ON_PAGE = 4.0;

/** Every selector in styles.css that is handed a set of surfaces.
 *
 *  This list is the actual guard, and it is worth being clear about why the
 *  rest of the file was not one.  `palette()` throws when it cannot find a
 *  block it was told to look for, which catches a palette that is *renamed
 *  or removed*.  It cannot catch the opposite and more likely mistake: a
 *  palette that is *added* and never mentioned here, which is measured by
 *  nothing, fails nothing, and is free to drift.  That is exactly what
 *  happened to the duplicated dark palette under `prefers-color-scheme`,
 *  and the comment recording it sits in styles.css to this day.
 *
 *  So the test below works the other way round: it finds every block in the
 *  stylesheet that declares a `--surface`, and fails if the set of
 *  selectors is not this one.  Adding a fourth paper breaks it until the
 *  paper is added to `describe.each` too, which is the intended way to find
 *  out. */
const MEASURED = [
  ":root",
  ".nx-theme-light",
  ':root[data-theme="dark"]',
  ':root[data-theme="light"] .nx-furniture',
  ".nx-theme-dark",
  ".nx-theme-white",
  ".nx-theme-warm",
  ".nx-theme-cool",
];

/** The stylesheet with its comments taken out.
 *
 *  Necessary rather than tidy: this file's comments are prose, prose has
 *  commas in it, and a selector list is split on commas.  Scanning the
 *  commented source produced a list of palette "selectors" that included
 *  half a sentence about hover-capable pointers. */
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

test("every palette in styles.css is one this file measures", () => {
  const declared = new Set<string>();
  for (const [, prelude, body] of BARE.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/--surface:\s*#/.test(body)) continue;
    // Everything between the previous rule's brace and this one's is the
    // prelude, which for the first rule in the file also contains every
    // @import above it. The selector list is whatever follows the last
    // semicolon.
    const selectors = prelude.split(";").pop() ?? "";
    for (const selector of selectors.split(",")) {
      const trimmed = selector.trim();
      if (trimmed) declared.add(trimmed);
    }
  }
  expect([...declared].sort()).toEqual([...MEASURED].sort());
});

test("no palette shadows the sizes appearance.ts sets on the root", () => {
  // --nx-ui-scale, --nx-editor-size and --nx-editor-weight live in a `:root`
  // block of their own, deliberately: every palette here is also handed to a
  // subtree, and redeclaring them inside one would shadow what appearance.ts
  // writes on the root, so the editor would quietly stop answering the
  // text-size control for anyone who had chosen a ground.
  //
  // --nx-editor-weight-*lift* is the opposite and belongs in the palettes:
  // it is what this palette adds to the writer's choice, not the choice.
  // The `\s*:` is what keeps the two apart here.
  for (const [, prelude, body] of BARE.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/--surface:\s*#/.test(body)) continue;
    expect(body, `a palette (${prelude.trim().slice(-40)}) redeclares a size`)
      .not.toMatch(/--nx-(ui-scale|editor-size|editor-weight)\s*:/);
  }
});

/** Everything that has to hold for a palette a person can actually be
 *  looking at.  The three papers are in here as well as the two themes,
 *  and today they pass by inheritance: a paper redefines its surfaces,
 *  --ink-3 and --line, and takes every accent and every syntax family from
 *  the light palette unchanged.  That is exactly why they belong here.  A
 *  paper that reaches for one more token -- a warmer --syn-preamble on book
 *  paper is the obvious temptation -- is measured by nothing otherwise, and
 *  the list above only forces a new paper to be *named* here, not checked. */
const PALETTES = [
  ["light", LIGHT],
  ["dark", DARK],
  ["white page", WHITE],
  ["warm page", WARM],
  ["cool page", COOL],
] as const;

describe.each(PALETTES)("%s theme", (_name, tokens) => {
  test("every token the palette names is defined", () => {
    for (const name of ["ink", "ink-2", "ink-3", "pen", "hint", "error", "warn",
                        "ok", "surround", "surface", "surface-2", "surface-3",
                        ...SYNTAX]) {
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

  test.each(SYNTAX)("%s on the page clears the syntax floor", (name) => {
    // 4:1 rather than 4.5:1, deliberately.  The whole argument is on
    // SYNTAX_ON_PAGE above; it is not a rounding of the rule beside it.
    const ratio = contrast(tokens[name], tokens["surface"]);
    expect(
      Number(ratio.toFixed(2)),
      `--${name} on --surface is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(SYNTAX_ON_PAGE);
  });
});

test("the dark theme redefines every colour the light one names", () => {
  // Only the colours: the derived tokens (--line, the washes, the shadows)
  // are either color-mix over these or deliberately different, and a colour
  // that exists only in one theme is the classic unreadable-artifact bug.
  const colours = [
    "surround", "surface", "surface-2", "surface-3",
    "ink", "ink-2", "ink-3", "pen", "on-pen", "hint", "error", "warn", "ok",
    ...SYNTAX,
  ];
  for (const name of colours) {
    expect(DARK[name], `--${name} is not redefined for the dark theme`)
      .toBeDefined();
    expect(DARK[name]).not.toBe(LIGHT[name]);
  }
});

// ---------------------------------------------------------------------------
// Structure, not just readability
//
// Everything above passed while the light theme had two inks pretending to
// be three, a 44-point canyon between the frame and the panes, and -- in
// dark -- two accents at the same luminance eight degrees apart in hue.
// Three audits went past all of it, because a contrast ratio cannot see any
// of it.  These are the assertions that can.

/** CIE L*, which is how far apart two greys look rather than how far apart
 *  their luminances are.  A 3.5-point gap is invisible; 8 is a step. */
function lightness(hex: string): number {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * y ** (1 / 3) - 16 : (24389 / 27) * y;
}

/** OKLCh chroma and hue, which is where the accents have to be separated
 *  because in a light theme their lightness is spoken for. */
function oklch(hex: string): { chroma: number; hue: number } {
  const lin = (i: number) => channel(hex, i);
  const [r, g, b] = [lin(0), lin(1), lin(2)];
  const cbrt = (x: number) => Math.cbrt(x);
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return {
    chroma: Math.hypot(a, bb),
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

const ACCENTS = ["pen", "hint", "error", "warn", "ok"];

describe.each(PALETTES)("%s theme structure", (_name, tokens) => {
  test("secondary and tertiary text are visibly different", () => {
    const gap = Math.abs(lightness(tokens["ink-2"]) - lightness(tokens["ink-3"]));
    expect(Number(gap.toFixed(1)), `--ink-2 to --ink-3 is ${gap.toFixed(1)} L*`)
      .toBeGreaterThanOrEqual(8);
  });

  test("no accent is so grey that its hue cannot be read", () => {
    for (const name of ACCENTS) {
      const { chroma } = oklch(tokens[name]);
      expect(Number(chroma.toFixed(3)), `--${name} chroma is ${chroma.toFixed(3)}`)
        .toBeGreaterThanOrEqual(0.07);
    }
  });

  test("no two accents are the same colour", () => {
    // In hue, because lightness is not available as a separator: the 4.5:1
    // rule on --surface-2 caps every light accent at about 0.11 luminance,
    // so they are all within seven L* of one another by construction.
    const hues = ACCENTS.map((name) => ({ name, ...oklch(tokens[name]) })).sort(
      (a, b) => a.hue - b.hue,
    );
    for (let i = 0; i < hues.length; i += 1) {
      const here = hues[i];
      const next = hues[(i + 1) % hues.length];
      const gap = (next.hue - here.hue + 360) % 360;
      expect(
        Number(gap.toFixed(1)),
        `--${here.name} and --${next.name} are ${gap.toFixed(1)}° apart`,
      ).toBeGreaterThanOrEqual(35);
    }
  });
});

describe.each(PALETTES)("%s theme syntax families", (_name, tokens) => {
  test("no two families are the same colour", () => {
    // Colouring the source is only worth doing if the colours mean
    // something, and five hues nobody can tell apart mean nothing.  The
    // threshold is lower than the accents' 35 degrees because there are
    // five of these on an arc that has to dodge violet -- --pen means the
    // agent touched this line, and a heading must never be mistaken for it.
    const hues = SYNTAX.map((name) => ({ name, ...oklch(tokens[name]) })).sort(
      (a, b) => a.hue - b.hue,
    );
    for (let i = 0; i < hues.length - 1; i += 1) {
      const gap = hues[i + 1].hue - hues[i].hue;
      expect(
        Number(gap.toFixed(1)),
        `--${hues[i].name} and --${hues[i + 1].name} are ${gap.toFixed(1)}° apart`,
      ).toBeGreaterThanOrEqual(40);
    }
  });

  test("no family is too dark for anyone to see what colour it is", () => {
    // Two palettes went out with muddy light-theme colours, and neither the
    // 4.5:1 floor nor the chroma floor below could see it.  Both passed.
    //
    // Chroma is the reason.  OKLCh chroma is not colourfulness: what the eye
    // reports is chroma weighted by how light the thing is, so a saturated
    // near-black reads as black.  #18448C carries a chroma of 0.129, more
    // than the dark theme's blue, and reads as navy-dark rather than as
    // blue, because it sits at lightness 0.40 on a page whose prose is a
    // near-black ink -- 22.6 L* away from the words it has to stand out
    // from, where even --ink-3 stands 27.3 away.
    //
    // So the quantity is chroma times lightness, and the threshold sits just
    // under what the palette the writer actually chose measures.  The two
    // rejected palettes score 0.021 and 0.028 at their weakest; this one
    // scores 0.040 and the dark theme 0.079.  In every light palette the
    // weakest is the teal, which sRGB starves at every lightness a light
    // page can use -- it is the family that sets this number, and if it ever
    // has to move, the hue is what should move rather than the floor.
    for (const name of SYNTAX) {
      const { chroma } = oklch(tokens[name]);
      const seen = (chroma * lightness(tokens[name])) / 100;
      expect(
        Number(seen.toFixed(3)),
        `--${name} reads as ${seen.toFixed(3)} colourful (chroma ${chroma.toFixed(3)} at L* ${lightness(tokens[name]).toFixed(1)})`,
      ).toBeGreaterThanOrEqual(0.038);
    }
  });

  test("no family melts into the prose beside it", () => {
    // The writer's own rule, and the one that decided this palette: "when
    // the focus is on the text, the keywords should be differentiated
    // enough from normal text and vice versa."  Distance from --ink, the
    // prose, rather than from the page behind it -- a command that is the
    // same darkness as the words around it is invisible however well it
    // measures against the paper.
    //
    // 14 L* is the dark theme's own margin, which has never been complained
    // about; the light palette now stands 34 to 39 clear.
    for (const name of SYNTAX) {
      const gap = Math.abs(lightness(tokens[name]) - lightness(tokens["ink"]));
      expect(
        Number(gap.toFixed(1)),
        `--${name} is ${gap.toFixed(1)} L* from the prose`,
      ).toBeGreaterThanOrEqual(14);
    }
  });

  test("no family is so grey that its hue cannot be read", () => {
    for (const name of SYNTAX) {
      const { chroma } = oklch(tokens[name]);
      expect(Number(chroma.toFixed(3)), `--${name} chroma is ${chroma.toFixed(3)}`)
        .toBeGreaterThanOrEqual(0.06);
    }
  });

  test("no family is mistakable for the colour that means the agent edited", () => {
    // --pen is the one accent that appears near the text itself, as the
    // wash on a line Claude has just changed.
    const pen = oklch(tokens["pen"]).hue;
    for (const name of SYNTAX) {
      const gap = Math.abs(oklch(tokens[name]).hue - pen);
      expect(
        Number(Math.min(gap, 360 - gap).toFixed(1)),
        `--${name} is ${Math.min(gap, 360 - gap).toFixed(1)}° from --pen`,
      ).toBeGreaterThanOrEqual(35);
    }
  });
});

test("a light page sets the editor heavier and a dark one does not", () => {
  // The other half of the same bug.  Dark type on a bright ground looks
  // thinner than light type on a dark one at the same weight, so the light
  // palette adds a step and the dark palette adds nothing.  It is a palette
  // token rather than a rule keyed on the theme because the editor can be
  // handed one palette while the app is in the other, and the three papers
  // inherit it by being applied together with `.nx-theme-light` -- so a
  // paper that declared its own would be a silent override, and there is
  // deliberately no place here for one to.
  const lift = (block: string) => {
    const start = CSS.indexOf(block);
    if (start < 0) throw new Error(`no such block in styles.css: ${block}`);
    const body = CSS.slice(start, CSS.indexOf("}", start));
    const found = body.match(/--nx-editor-weight-lift:\s*(\d+)/);
    return found ? Number(found[1]) : null;
  };
  expect(lift(".nx-theme-light {"), "the light palette lifts the editor weight")
    .toBe(100);
  expect(lift(".nx-theme-dark {"), "the dark palette lifts nothing").toBe(0);
  for (const paper of [".nx-theme-white {", ".nx-theme-warm {", ".nx-theme-cool {"]) {
    expect(lift(paper), `${paper} should inherit the light palette's lift`).toBe(null);
  }
});

test("every weight the editor can reach has a font file behind it", () => {
  // The ladder is 300/400/500, a light page adds 100, and a control
  // sequence is set 200 above the prose with a ceiling of 700.  So the
  // reachable set is 300 through 700, and a weight that is not imported is
  // not downloaded -- it is synthesised from the nearest one, which in a
  // monospace face is a smeared outline rather than a heavier letter.
  for (const weight of [300, 400, 500, 600, 700]) {
    expect(CSS, `source-code-pro ${weight} is reachable but not imported`)
      .toContain(`@fontsource/source-code-pro/${weight}.css`);
  }
});

test("the frame and the panes are one ramp, not a cliff", () => {
  // Only in light: the dark surround is deliberately near-black so the
  // sheet reads as lit, and the panes take their separation from --line and
  // the page shadow instead.
  const gap = 100 * (luminance(LIGHT["surface"]) - luminance(LIGHT["surround"]));
  expect(Number(gap.toFixed(1)), `--surround to --surface is ${gap.toFixed(1)} points`)
    .toBeLessThanOrEqual(30);
});
