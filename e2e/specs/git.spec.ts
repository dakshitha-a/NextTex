import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";
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

/** The git drawer, from the bar: Files is the default. */
async function gitDrawer(tab: Page) {
  const drawer = tab.getByTestId("drawer");
  const showing =
    (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === "git";
  if (!showing) await tab.getByTestId("bar-git").click();
}

test("a project with no repository can be given one", async ({ tab, project }) => {
  await gitDrawer(tab);
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
  await gitDrawer(tab);
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

/** Every button in a git surface holds its label on one line, at the
 *  narrowest rail there is.  The card had three labels in one row, no wrap
 *  on the row and no `nowrap` on the labels, so each wrapped inside its
 *  own 26px box and the card showed the top half of every word. */
async function fitting(page: import("@playwright/test").Page, within: string) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    return [...(root?.querySelectorAll("button") ?? [])].map((b) => {
      // The line boxes the label actually occupies, rather than the
      // button's height over its line height: a quiet control in a row
      // with a 26px button is stretched to 26px and is still one line.
      const range = document.createRange();
      range.selectNodeContents(b);
      const tops = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      return {
        text: (b.textContent ?? "").trim(),
        over: b.scrollWidth - b.clientWidth,
        lines: tops.size,
      };
    });
  }, within);
}

test("the card's buttons fit at the narrowest rail", async ({ page, app, project }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  // The rail at its minimum, before the project opens and reads it back.
  await page.evaluate(
    (id) => {
      localStorage.setItem(`nexttex.widths.${id}`, JSON.stringify({ rail: 180 }));
      // And the git drawer showing, since Files is the drawer a project
      // opens on.
      localStorage.setItem(`nexttex.drawer.${id}`, JSON.stringify({ open: "git" }));
    },
    project.id,
  );
  await openProject(page, project.root);
  const card = page.getByTestId("git-setup");
  await expect(card).toBeVisible({ timeout: 20_000 });

  const check = async (where: string) => {
    const buttons = await fitting(page, where);
    expect(buttons.length, where).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.over, `"${b.text}" overflows by ${b.over}px`).toBeLessThanOrEqual(1);
      expect(b.lines, `"${b.text}" wrapped`).toBe(1);
    }
  };
  // No repository: "Keep versions here" over the quiet pair.
  await check('[data-testid="git-setup"]');
  // A repository and no remote: the GitHub card.
  await page.getByTestId("git-init").click();
  await expect(page.getByTestId("git-init")).toHaveCount(0, { timeout: 20_000 });
  await expect(card).toContainText("Back this up to GitHub");
  await check('[data-testid="git-setup"]');
  // And the wizard behind it.
  await page.getByTestId("git-backup").click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await check('[data-testid="git-wizard"]');
});

test("the line left after setting the card aside fits at the narrowest rail too", async ({
  page, app, project,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.evaluate(
    (id) => {
      localStorage.setItem(`nexttex.widths.${id}`, JSON.stringify({ rail: 180 }));
      // And the git drawer showing, since Files is the drawer a project
      // opens on.
      localStorage.setItem(`nexttex.drawer.${id}`, JSON.stringify({ open: "git" }));
    },
    project.id,
  );
  await openProject(page, project.root);
  await expect(page.getByTestId("git-setup")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("git-init-again")).toBeVisible();
  for (const b of await fitting(page, '[data-testid="git-aside"]')) {
    expect(b.over, `"${b.text}" overflows by ${b.over}px`).toBeLessThanOrEqual(1);
    expect(b.lines, `"${b.text}" wrapped`).toBe(1);
  }
});

test("the git drawer is remembered across a reload, and the offer is the first thing in it", async ({
  tab,
}) => {
  // One drawer at a time now, opened from the bar; the choice is kept per
  // project, so a writer who left the repository showing finds it
  // showing.  A project with no repository opens the drawer on the offer
  // to keep versions.
  await tab.getByTestId("bar-git").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "git");
  await expect(tab.getByTestId("git-setup")).toBeVisible({ timeout: 20_000 });

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "git");
  await expect(tab.getByTestId("git-setup")).toBeVisible({ timeout: 20_000 });

  // A second press folds it; the bar stays.
  await tab.getByTestId("bar-git").click();
  await expect(tab.getByTestId("git-setup")).toHaveCount(0);
  await expect(tab.getByTestId("activity-bar")).toBeVisible();
});

test("setting the card aside on a project with no repository leaves a way back", async ({
  tab, project,
}) => {
  // The footer has had a way back to the wizard since "Not now" was found
  // to have no later, but the footer only draws for a project with a
  // repository. On a project without one the panel was simply empty, and
  // init was gone for the life of the project.
  await gitDrawer(tab);
  await expect(tab.getByTestId("git-setup")).toBeVisible({ timeout: 20_000 });
  await tab.getByRole("button", { name: "Not now" }).click();
  await expect(tab.getByTestId("git-setup")).toHaveCount(0);

  await expect(tab.getByTestId("git-init-again")).toBeVisible();
  expect(existsSync(join(project.root, ".git"))).toBe(false);
  await tab.getByTestId("git-init-again").click();
  await expect(tab.getByTestId("git-init-again")).toHaveCount(0, { timeout: 20_000 });
  expect(existsSync(join(project.root, ".git"))).toBe(true);
  // With a repository and no remote, the footer takes over.
  await expect(tab.getByTestId("back-up-again")).toBeVisible();
});
