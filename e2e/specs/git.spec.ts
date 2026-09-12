import { test, expect } from "../fixtures";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { landed } from "../typing";

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

test("what changed in a file can be read in the panel, not only named", async ({
  tab, app, project,
}) => {
  // R-089. "See what changed" showed a status letter and a path. The
  // chevron beside a row is the agent's edit chip idiom: it opens the
  // patch, and the row itself still opens the file.
  await tab.getByTestId("git-init").click();
  await expect(tab.getByTestId("git-init")).toHaveCount(0, { timeout: 20_000 });
  // The card then offers GitHub; the panel itself is behind "Not now".
  // Making the repository made the first commit too, so there is already
  // something for an edit to differ from.
  await tab.getByRole("button", { name: "Not now" }).click();

  // An edit, and the patch for it.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA line that was not there before.");
  await landed(app, project, "A line that was not there before.");
  await expect(tab.getByText(/file(s)? changed/)).toBeVisible({ timeout: 30_000 });
  await tab.getByText(/file(s)? changed/).click();

  const row = tab.getByTestId("git-change").filter({ hasText: "main.tex" });
  await expect(row).toBeVisible();
  await row.getByTestId("git-change-toggle").click();
  const patch = tab.getByTestId("git-patch");
  await expect(patch).toBeVisible({ timeout: 10_000 });
  await expect(patch).toContainText("+A line that was not there before.");
});
