import { test, expect, openProject } from "../fixtures";
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
    (id) => localStorage.setItem(`nexttex.widths.${id}`, JSON.stringify({ rail: 180 })),
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

test("the panel is open until it is folded, and stays folded across a reload", async ({
  tab,
}) => {
  // The one thing in the rail that could not fold, and the first-run card
  // is the tallest thing the rail holds. A project with nothing stored
  // opens with it showing, so the offer to keep versions is seen once.
  const toggle = tab.getByTestId("git-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tab.getByTestId("git-setup")).toBeVisible({ timeout: 20_000 });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(tab.getByTestId("git-setup")).toHaveCount(0);

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.getByTestId("git-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(tab.getByTestId("git-setup")).toHaveCount(0);
});

test("a rail remembered from before the panel could fold still opens it", async ({
  page, app, project,
}) => {
  // What is stored is merged over the default, key by key. A project
  // whose rail was remembered before there was a `git` key would
  // otherwise come back with the panel closed, and the writer would have
  // no idea it had gained a header.
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.evaluate(
    (id) => localStorage.setItem(
      `nexttex.rail.${id}`,
      JSON.stringify({ files: true, sections: false, search: false }),
    ),
    project.id,
  );
  await openProject(page, project.root);
  await expect(page.getByTestId("git-toggle")).toHaveAttribute("aria-expanded", "true");
  // And the keys it did have are honoured, so this is a merge and not a
  // reset to the default.
  await expect(page.getByTestId("sections-toggle")).toHaveAttribute("aria-expanded", "false");
});
