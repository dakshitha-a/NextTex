import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where Chromium actually is on this machine.
 *
 *  Playwright pins a build number and refuses anything else, but the one
 *  cached here was downloaded by an older release, so leaving it to resolve
 *  its own default fails with a "browser is not installed" message that has
 *  nothing to do with what is on disk.  The newest cached chromium-* is the
 *  right answer, and NEXTTEX_CHROME overrides it.
 */
export function chromePath(): string | undefined {
  const named = process.env.NEXTTEX_CHROME;
  if (named && existsSync(named)) return named;

  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    // Numerically: chromium-1234 is newer than chromium-987, and sorting
    // these as strings says the opposite.
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const candidate = join(cache, build, "chrome-linux64", "chrome");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
