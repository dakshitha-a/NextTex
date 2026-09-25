import { execFileSync } from "node:child_process";
import { existsSync, statSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./server";

/** Build the frontend if what is in dist/ is older than the source.
 *
 *  `server/main.py` decides at import time whether a built frontend exists,
 *  so dist/ has to be there and current *before* any of these servers
 *  start -- otherwise every route falls through to the "not built" stub and
 *  every spec fails for a reason that has nothing to do with what it tests.
 */
export default function build(): void {
  sweepOldSandboxes();
  const dist = join(ROOT, "frontend", "dist", "index.html");
  const src = join(ROOT, "frontend", "src");
  const newest = (dir: string): number => {
    let latest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      latest = Math.max(
        latest,
        entry.isDirectory() ? newest(path) : statSync(path).mtimeMs,
      );
    }
    return latest;
  };
  if (existsSync(dist) && statSync(dist).mtimeMs > newest(src)) return;
  execFileSync("npm", ["run", "build"], {
    cwd: join(ROOT, "frontend"),
    stdio: "inherit",
  });
}

/** Sandboxes a run left behind when it ended before `stop()`, a killed
 *  run or a review driver that threw: removed once they are a day old, so
 *  a sandbox another run is using now is never touched. The probe of
 *  September 2026 found 591 of them in /tmp (Q-069). */
function sweepOldSandboxes(): void {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith("nexttex-e2e-")) continue;
    const path = join(tmpdir(), name);
    try {
      if (statSync(path).mtimeMs < dayAgo) rmSync(path, { recursive: true, force: true });
    } catch {
      // Another user's, or gone already: not this run's to worry about.
    }
  }
}
