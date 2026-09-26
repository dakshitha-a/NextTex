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
