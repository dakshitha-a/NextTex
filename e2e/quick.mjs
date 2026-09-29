// Which browser specs the quick tier runs: the ones the changed files reach.
//
// The changed files are the working tree against origin/master, committed,
// staged, unstaged and new. Each is looked up in areas.json; a changed spec
// runs itself. A change under frontend/ or server/ that no area names, or a
// change to the browser tier's own machinery, runs everything, and says why
// on stderr, so the table is grown rather than a spec quietly skipped.
//
// Prints the spec paths to run, one per line, relative to e2e/, or the one
// word ALL. Run from anywhere: `node e2e/quick.mjs`.
// NEXTTEX_QUICK_FILES="frontend/src/panes/Pdf.tsx" node e2e/quick.mjs
// says what a change to that file alone would run.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const table = JSON.parse(readFileSync(join(HERE, "areas.json"), "utf8"));
const specs = readdirSync(join(HERE, "specs"))
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => name.slice(0, -".spec.ts".length));

/** A glob as a regular expression: `*` within a segment, `**` any depth. */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i += 1;
    } else if (c === "*") {
      out += "[^/]*";
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/** The spec names a pattern names: a name, or a family ending in `*`. */
function expand(pattern) {
  const match = globToRegExp(pattern);
  return specs.filter((name) => match.test(name));
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// NEXTTEX_QUICK_FILES names the changed files instead, space separated,
// for asking what a change would run and for the test of this table.
const named = (process.env.NEXTTEX_QUICK_FILES ?? "").split(/\s+/).filter(Boolean);
const changed = new Set(named.length ? named : [
  ...git("diff", "--name-only", "origin/master...HEAD"),
  ...git("diff", "--name-only"),
  ...git("diff", "--name-only", "--cached"),
  ...git("ls-files", "--others", "--exclude-standard"),
]);

const chosen = new Set(table.always.flatMap(expand));
const everything = [];

for (const path of changed) {
  const spec = path.match(/^e2e\/specs\/(.+)\.spec\.ts$/);
  if (spec) {
    chosen.add(spec[1]);
    continue;
  }
  const areas = table.areas.filter((area) =>
    area.sources.some((glob) => globToRegExp(glob).test(path)),
  );
  if (areas.length) {
    for (const area of areas) {
      if (area.specs.includes("*")) everything.push(`${path} is ${area.name}`);
      for (const pattern of area.specs) for (const name of expand(pattern)) chosen.add(name);
    }
    continue;
  }
  const test = /\.test\.tsx?$/.test(path);
  if (path.startsWith("e2e/") && !path.startsWith("e2e/review/") && !path.startsWith("e2e/shots/")) {
    everything.push(`${path} is the browser tier's own machinery`);
  } else if ((path.startsWith("frontend/") || path.startsWith("server/")) && !test) {
    everything.push(`${path} is in no area of e2e/areas.json`);
  }
}

if (everything.length) {
  process.stderr.write(`quick: running every spec, because\n${everything.map((why) => `  ${why}`).join("\n")}\n`);
  process.stdout.write("ALL\n");
} else {
  const list = [...chosen].sort();
  process.stderr.write(`quick: ${list.length} of ${specs.length} specs, for ${changed.size} changed files\n`);
  process.stdout.write(list.map((name) => `specs/${name}.spec.ts`).join("\n") + "\n");
}
