import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

// A NextTex of its own: this spec changes the agent provider, which the
// whole install holds.
test.use({ ownServer: true });

/** Writing with no agent turns the agent off, not just its column.
 *
 *  The writer asked that with "No agent" chosen nothing about the agent
 *  works or shows: not the column, its strip, its button, its shortcut or
 *  its peek from the window's edge, and not the controls elsewhere that
 *  hand something to it, the selection's verbs, a build error's Fix and
 *  the palette's action. */
test("with no agent, nothing about the agent shows or answers", async ({ app, project, page }) => {
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  });
  writeFileSync(join(project.root, "main.tex"), [
    "\\documentclass{article}",
    "\\begin{document}",
    "A paragraph long enough to select for the verbs, with an error $x.",
    "\\end{document}",
    "",
  ].join("\n"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // No column, no strip, no button.
  await expect(page.getByTestId("chat-panel")).toHaveCount(0);
  await expect(page.getByTestId("collapsed-claude")).toHaveCount(0);
  await expect(page.locator('[data-testid^="agent-button"]')).toHaveCount(0);

  // The shortcut and the window's edge bring nothing.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+a");
  await page.mouse.move(1400, 500);
  await page.mouse.move(1599, 500, { steps: 4 });
  await page.waitForTimeout(500);
  await expect(page.getByTestId("chat-panel")).toHaveCount(0);

  // The selection's row offers Comment and none of the agent's verbs.
  await page.locator(".cm-line", { hasText: "A paragraph long enough" }).click({ clickCount: 3 });
  const row = page.getByTestId("selection-actions");
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Reword" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Ask" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Comment/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // A build error has Copy and no Fix.
  await page.getByTestId("bar-build").click();
  const diagnostics = page.getByTestId("diagnostics");
  const copy = diagnostics.getByText("Copy", { exact: true }).first();
  await expect(copy).toBeAttached({ timeout: 45_000 });
  await expect(diagnostics.getByText("Fix", { exact: true })).toHaveCount(0);

  // The palette does not offer the agent.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("agent");
  await expect(page.getByText("Show or hide the agent")).toHaveCount(0);
});
