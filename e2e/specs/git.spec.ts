import { test, expect } from "../fixtures";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The local half of version control.
 *
 *  R-095. The panel only ever sent commit, push and pull, so a project with
 *  no repository was shown the GitHub wizard and nothing else: making a
 *  repository, which needs no account and no connection, was reachable
 *  only from a terminal. The route has taken `init` the whole time.
 */

test("a project with no repository can be given one", async ({ tab, project }) => {
  const card = tab.getByTestId("git-setup");
  await expect(card).toBeVisible({ timeout: 20_000 });
  // The card leads with the thing that works offline, and offers the
  // network answer second.
  await expect(card).toContainText("Keep versions of this project");
  expect(existsSync(join(project.root, ".git"))).toBe(false);

  await tab.getByTestId("git-init").click();

  // The panel stops offering it, because the repository is there.
  await expect(tab.getByTestId("git-init")).toHaveCount(0, { timeout: 20_000 });
  expect(existsSync(join(project.root, ".git"))).toBe(true);
  // And the README's promise: the ignore file comes with it, so a build
  // directory is not the first thing committed.
  expect(existsSync(join(project.root, ".gitignore"))).toBe(true);
});
