import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/** The style guide's rule, held: every control comes from `src/ui/`, and a
 *  literal size or colour in a component is a defect.
 *
 *  Nothing enforced it, which is how 88 raw controls and 189 literal sizes
 *  were found outside the kit by the probe of September 2026 (Q-038). This
 *  test began as a ratchet, each file allowed what it held, and the backlog
 *  close-out moved every file onto the kit, so the allowance is gone and
 *  the rule is simply held. The one exception is the hidden file input,
 *  since a browser has no other way to ask for files: the pattern below
 *  does not count an `<input type="file">`. */

const HERE = dirname(fileURLToPath(import.meta.url));

/** A raw control: a lower-case button, input, select or textarea element. */
const RAW = /<(button|input|select|textarea)\b(?![^>]*type="file")/g;
/** A literal size or colour: an arbitrary Tailwind value in px or a hex. */
const LITERAL = /\b[a-z-]+-\[(?:-?\d+(?:\.\d+)?px|#[0-9a-fA-F]{3,8})\]/g;

function components(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "ui" || name === "node_modules") continue;
      out.push(...components(path));
    } else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) {
      out.push(path);
    }
  }
  return out;
}

function count(): Record<string, { raw: number; literal: number }> {
  const found: Record<string, { raw: number; literal: number }> = {};
  for (const path of components(HERE)) {
    const text = readFileSync(path, "utf8");
    const raw = (text.match(RAW) ?? []).length;
    const literal = (text.match(LITERAL) ?? []).length;
    if (raw || literal) found[relative(HERE, path)] = { raw, literal };
  }
  return found;
}

describe("the kit is the only source of controls", () => {
  test("no component holds a raw control or a literal size", () => {
    expect(count()).toEqual({});
  });
});

/** The motion language's rule, held: a duration that is one of the five
 *  tokens is written as the token (docs/style-guide.md, "Motion").  The
 *  stylesheet and every component are read for a transition, an animation
 *  or a Tailwind duration that spells one of the token values out.  The
 *  longer fades, a jump's highlight, a line's arrival, the name's glide,
 *  are marks with their own schedule and are not token values. */
describe("motion", () => {
  const TOKEN_VALUES = /(?<![\d.])(90|120|140|180)ms\b/;
  const MOTION = /\b(transition|animation|duration-\[)/;
  test("durations that are tokens are written as the tokens", () => {
    const offenders: string[] = [];
    const files = [join(HERE, "styles.css"), ...components(HERE)];
    for (const path of files) {
      readFileSync(path, "utf8").split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (MOTION.test(line) && TOKEN_VALUES.test(line)) {
          offenders.push(`${relative(HERE, path)}:${index + 1}: ${trimmed}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
