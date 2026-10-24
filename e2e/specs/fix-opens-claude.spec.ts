import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openProject } from "../fixtures";

/** Fix on a build error brings the Claude column.
 *
 *  The writer pressed Fix with the column folded and saw nothing happen:
 *  the error had gone into a composer nobody could see. Fix now unfolds
 *  the docked column, or opens the parked overlay on a narrower window,
 *  and leaves the error in the composer with the caret after it. An
 *  agent chosen but not set up says so in a notice. */

const column = (page: Page) => page.getByTestId("chat-panel");

async function openWithAnError(page: Page, app: { base: string; token: string }, root: string, width: number) {
  writeFileSync(join(root, "main.tex"), [
    "\\documentclass{article}",
    "\\begin{document}",
    "A paragraph with an error $x.",
    "\\end{document}",
    "",
  ].join("\n"));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
}

async function pressFix(page: Page) {
  await page.getByTestId("bar-build").click();
  const fix = page.getByTestId("diagnostic-fix").first();
  await expect(fix).toBeAttached({ timeout: 45_000 });
  await fix.locator("xpath=ancestor::*[contains(@class,'group')][1]").hover();
  await fix.click();
}

test("Fix unfolds the docked column and leaves the error in its composer", async ({ app, project, page }) => {
  await openWithAnError(page, app, project.root, 1600);
  await expect(column(page)).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+a");
  await expect(column(page)).toBeHidden();

  await pressFix(page);
  await expect(column(page)).toBeVisible();
  const composer = column(page).locator("textarea");
  await expect(composer).toHaveValue(/^Fix: .+\(main\.tex:\d+\)$/);
  await expect(composer).toBeFocused();
  // Seeded, not sent: nothing is working.
  await expect(page.getByTestId("working")).toHaveCount(0);
});

test("on a narrower window Fix opens the parked column", async ({ app, project, page }) => {
  await openWithAnError(page, app, project.root, 1200);
  // Below 1400 px the column is an overlay, parked until asked for.
  if (await column(page).isVisible()) {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Escape");
  }
  await expect(column(page)).toBeHidden();

  await pressFix(page);
  await expect(column(page)).toBeVisible();
  await expect(column(page).locator("textarea")).toHaveValue(/^Fix: /);
});

test("with the agent not set up, Fix says so", async ({ app, project, page }) => {
  await openWithAnError(page, app, project.root, 1600);
  // The sign-in lapsed after the page loaded: the next status says so.
  await page.route("**/api/agent/status", (route) =>
    route.fulfill({ json: { provider: "claude", ready: false, installed: true, loggedIn: false } }),
  );
  await pressFix(page);
  await expect(page.getByTestId("notices")).toContainText(
    "This works with Claude, which is not set up yet. Set it up in Settings, under Writing agent.",
  );
});
