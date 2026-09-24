import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Grammar and style, locally, with Harper.
 *
 *  A dashed underline beside spelling's dotted one, the same menu with
 *  Harper's sentence at its head, and two ways to leave a finding alone:
 *  for now, or in this project. English only, and it rests in a project
 *  spelled in another language.
 */

async function turnOn(tab: Page) {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("settings-group-write").click();
  await tab.getByTestId("grammar-on").click();
  await tab.keyboard.press("Escape");
}

async function type(tab: Page, text: string) {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type(text + "\n");
}

const found = (tab: Page) => tab.locator(".nx-grammar");

test("a repeated word is found, explained and replaced from the menu", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "The the decay is fast, as \\cite{knuth1984} shows.");
  // Harper arrives on first use; the citation is not read as a sentence.
  await expect(found(tab).first()).toBeVisible({ timeout: 45_000 });
  await expect(found(tab)).toHaveText(["The the"]);

  await found(tab).first().click({ button: "right" });
  const menu = tab.getByTestId("spelling-menu");
  await expect(menu).toContainText("repeat");
  await menu.getByRole("menuitem", { name: "The", exact: true }).click();
  await expect(tab.locator(".cm-content")).toContainText("The decay is fast");
  await expect(found(tab)).toHaveCount(0, { timeout: 10_000 });
});

test("a finding ignored in this project stays ignored after a reload", async ({ tab, project }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await turnOn(tab);
  await type(tab, "We see that that the decay is fast.");
  await expect(found(tab).first()).toBeVisible({ timeout: 45_000 });
  await found(tab).first().click({ button: "right" });
  await tab.getByTestId("ignore-in-project").click();
  await expect(found(tab)).toHaveCount(0, { timeout: 10_000 });
  expect(readFileSync(join(project.root, ".nexttex", "grammar-ignored.txt"), "utf8")).toContain("that that");

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.waitForTimeout(4000);
  await expect(found(tab)).toHaveCount(0);
});

test("grammar rests in a project spelled in another language", async ({ app, project, tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await fetch(`${app.base}/api/projects/${project.id}/settings`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ language: "de" }),
  });
  await turnOn(tab);
  await type(tab, "The the decay is fast.");
  await tab.waitForTimeout(6000);
  await expect(found(tab)).toHaveCount(0);
});
