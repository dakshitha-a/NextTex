import { execFileSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
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
