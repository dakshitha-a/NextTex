import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/** The style guide's rule, held: every control comes from `src/ui/`, and a
 *  literal size or colour in a component is a defect.
 *
 *  Nothing enforced it, which is how 88 raw controls and 189 literal sizes
 *  were found outside the kit by the probe of September 2026 (Q-038). They
 *  are too many to move in one change without churning every pane, so this
 *  is a ratchet: each file may hold at most what it held when the rule
 *  started being enforced, listed below, and a file not listed may hold
 *  none. A change that moves a file onto the kit lowers its number here;
 *  a change that adds one fails. The hidden file inputs are the fair
 *  exception, since a browser has no other way to ask for files, and are
 *  not counted. */

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

const ALLOWED: Record<string, { raw: number; literal: number }> = JSON.parse(
  readFileSync(join(HERE, "kit-rule.allowed.json"), "utf8"),
);

describe("the kit is the only source of controls", () => {
  test("no file holds more raw controls or literal sizes than it did", () => {
    const over: string[] = [];
    for (const [file, now] of Object.entries(count())) {
      const was = ALLOWED[file] ?? { raw: 0, literal: 0 };
      if (now.raw > was.raw) over.push(`${file}: ${now.raw} raw controls, allowed ${was.raw}`);
      if (now.literal > was.literal) over.push(`${file}: ${now.literal} literal sizes, allowed ${was.literal}`);
    }
    expect(over).toEqual([]);
  });

  test("the allowance is lowered as files move onto the kit", () => {
    // A number left above what the file now holds would let the next
    // change add back what this one removed.
    const now = count();
    const slack = Object.entries(ALLOWED)
      .filter(([file, was]) => {
        const is = now[file] ?? { raw: 0, literal: 0 };
        return is.raw < was.raw || is.literal < was.literal;
      })
      .map(([file]) => file);
    expect(slack).toEqual([]);
  });
});
