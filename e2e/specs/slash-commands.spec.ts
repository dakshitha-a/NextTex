import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";
import { startServer, seedProject } from "../server";

/** A `/` at the start of the composer names a reusable prompt.
 *
 *  The two reviews ship inside NextTex, a project's `prompts/` can add
 *  or replace one, and the expansion happens on the server before the
 *  model sees the question, so the transcript keeps what was typed. The
 *  scripted agent's `context` script says back what came ahead of the
 *  question, which is how a browser can see the file's text reached the
 *  agent without reading the server's memory.
 */

test("typing a slash offers the prompts, Enter completes one, and the agent gets the file's text", async ({
  page,
}) => {
  const app = await startServer({ NEXTTEX_SCRIPTED_AGENT: "context" });
  try {
    const project = await seedProject(app, `slash-${Date.now()}`);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

    const composer = page.locator("textarea");
    await composer.click();
    await composer.pressSequentially("/rev");
    const menu = page.getByTestId("prompt-menu");
    await expect(menu).toBeVisible({ timeout: 10_000 });
    const rows = menu.getByTestId("prompt-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("/review critical");
    await expect(rows.nth(1)).toContainText("/review friendly");
    await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");

    // Down to the friendly one, Enter completes it, and nothing was sent.
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(composer).toHaveValue("/review friendly ");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("working")).toHaveCount(0);

    // A note after the name goes with it; Enter now sends.
    await composer.pressSequentially("the abstract only");
    await page.keyboard.press("Enter");
    // The transcript shows the line as typed, and the answer, which is
    // what the agent was given ahead of the question, is the file's text
    // with the note on its end.
    await expect(page.getByText("/review friendly the abstract only")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/as a mentor would/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/The writer adds: the abstract only/)).toBeVisible();

    // A slash that names nothing is sent as typed, with nothing ahead of it.
    await composer.fill("/frobnicate this");
    await expect(page.getByTestId("prompt-menu")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Nothing came ahead of the question.")).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await app.stop();
  }
});

test("the Context panel lists the prompts, and a copy puts the file in the project", async ({
  tab,
  project,
}) => {
  await tab.getByRole("button", { name: /What .* reads/ }).click();
  const list = tab.getByTestId("prompts-list");
  const entries = list.getByTestId("prompt-entry");
  await expect(entries).toHaveCount(2, { timeout: 10_000 });
  await expect(entries.nth(1)).toContainText("/review friendly");
  await expect(entries.nth(1)).toHaveAttribute("data-source", "builtin");

  await entries.nth(1).hover();
  await entries.nth(1).getByTestId("prompt-copy").click();
  // The entry is the project's now, and the file is in the tree where
  // the group can edit it.
  await expect(entries.nth(1)).toHaveAttribute("data-source", "project", { timeout: 10_000 });
  await expect(entries.nth(1).getByTestId("prompt-copy")).toHaveCount(0);
  // The tree is the Files drawer's, which is already showing unless the
  // drawer was folded.
  if ((await tab.getByTestId("drawer").count()) === 0) await tab.getByTestId("bar-files").click();
  await openFolders(tab, "prompts/review-friendly.md");
  await expect(tab.locator('[role="tree"] [data-path="prompts/review-friendly.md"]')).toBeVisible();

  // And the composer marks the copy as this project's; the view gives
  // way to the conversation first.
  await tab.getByTestId("reads-back").click();
  const composer = tab.locator("textarea");
  await composer.click();
  await composer.pressSequentially("/review f");
  const rows = tab.getByTestId("prompt-menu").getByTestId("prompt-row");
  await expect(rows).toHaveCount(1, { timeout: 10_000 });
  await expect(rows.first()).toContainText("this project's");
  // Escape puts the menu away and leaves the draft alone.
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("prompt-menu")).toHaveCount(0);
  await expect(composer).toHaveValue("/review f");

  // A project prompt whose name is the start of another's: on `/review `
  // both rows are up and the draft already is one of them, so Enter sends
  // rather than filling the same name in again.
  writeFileSync(join(project.root, "prompts", "review.md"), "Just review it.\n");
  await composer.fill("");
  await composer.pressSequentially("/rev");
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
  await composer.pressSequentially("iew ");
  await expect(tab.getByTestId("prompt-menu")).toHaveCount(0);
  await tab.keyboard.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(tab.getByText("/review", { exact: true })).toBeVisible({ timeout: 20_000 });
});
