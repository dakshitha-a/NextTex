import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Read off disk, in the shape of contrast.test.ts: what is being checked is
// what somebody wrote, not what the bundler made of it.
const HERE = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "vendor" || name === "node_modules") continue;
      found.push(...sources(path));
    } else if (name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/** No control saves a file with a link.
 *
 *  A bare `<a download>` inside an open project over HTTPS is cancelled by
 *  Chrome before a byte is sent, once the page has been open about ten
 *  seconds: the ZIP, a single file, a PDF, all of them, with nothing in the
 *  server log.  `download` in chrome.tsx fetches instead, and 43e9c2c moved
 *  every control onto it.
 *
 *  That sweep's guard was to delete `startDownload` from api.ts, so that
 *  nothing could reach for the link again.  It could not work: the figure
 *  viewer's Download, added twelve hours earlier in 162a105, had never
 *  called `startDownload`.  It was named in that commit's own body as one of
 *  the five broken controls and it survived the sweep anyway, and so did the
 *  preview strip's Save PDF.  A guard has to forbid the shape, not one road
 *  to it, which is what this does.
 *
 *  The one legitimate spelling is `anchor.download = filename` inside
 *  `saveBlob` in api.ts, which is how a fetched blob is handed to the
 *  browser.  It is imperative, it is not JSX, and it is not what this looks
 *  for: an anchor written as markup with a `download` attribute on it.
 */
test("no control downloads a file through a link", () => {
  const offenders: string[] = [];
  for (const path of sources(HERE)) {
    // Comments are blanked rather than cut, so a reported line number is
    // still the line in the file.  They have to go: chrome.tsx's own
    // explanation of this defect quotes the shape it forbids, and a guard
    // that fails on the sentence describing it would be read as noise and
    // deleted, which is how a guard is lost.
    const text = readFileSync(path, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, (found) => found.replace(/[^\n]/g, " "))
      .replace(/^[ \t]*\/\/.*$/gm, (found) => found.replace(/[^\n]/g, " "));
    // Across lines, deliberately.  The anchor this was written for spans
    // seven of them, so a line-at-a-time search would have passed on the
    // very defect that prompted it.  From `<a` to the first `>` that closes
    // the opening tag, with no `<` in between so a later element cannot be
    // swallowed.
    for (const match of text.matchAll(/<a\b[^<>]*>/g)) {
      if (!/(^|\s)download(\s|=|\/?>)/.test(match[0])) continue;
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${relative(HERE, path)}:${line}`);
    }
  }
  expect(
    offenders,
    "these anchors save a file by linking to it; use `download` from chrome.tsx instead",
  ).toEqual([]);
});
