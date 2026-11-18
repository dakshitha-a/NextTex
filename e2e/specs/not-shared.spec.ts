import { test, expect } from "../fixtures";
import { mkdirSync, symlinkSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What a shared project leaves out, drawn on the direction page's
 *  #notshared section: a row the share leaves out says so in its tail,
 *  its menu can stop or start sharing it, and the settings sheet's This
 *  project group keeps the list. A project nobody else holds says nothing. */

test("a shared project marks what it leaves out, and the list is edited in place", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const elsewhere = mkdtempSync(join(tmpdir(), "nexttex-elsewhere-"));
  writeFileSync(join(elsewhere, "notes.md"), "Somebody else's notes.\n");
  mkdirSync(join(project.root, "refs"), { recursive: true });
  symlinkSync(join(elsewhere, "notes.md"), join(project.root, "refs", "notes.md"));
  mkdirSync(join(project.root, "scratch"), { recursive: true });
  writeFileSync(join(project.root, "scratch", "try.txt"), "a try\n");
  writeFileSync(join(project.root, "main.log"), "This is pdfTeX.\n");

  const row = (path: string) => tab.locator(`[role="tree"] [data-path="${path}"]`);
  await expect(row("main.log")).toBeVisible({ timeout: 20_000 });
  // Private: nothing is said.
  await expect(tab.getByTestId("not-shared")).toHaveCount(0);

  const base = `${app.base}/api/projects/${project.id}/collab`;
  expect((await tab.request.post(`${base}/share`, { data: { name: "Wilhelmina" } })).ok()).toBeTruthy();
  await expect(row("main.log").getByTestId("not-shared")).toBeVisible({ timeout: 20_000 });
  await row("refs").click();
  await expect(row("refs/notes.md").getByTestId("not-shared")).toHaveAttribute(
    "title", "Not shared: a link to outside the project",
  );
  await expect(row("scratch").getByTestId("not-shared")).toHaveCount(0);

  // Stop sharing a folder from its menu.
  await tab.getByLabel("Actions for scratch").click();
  await tab.getByRole("button", { name: "Stop sharing this" }).click();
  await expect(row("scratch").getByTestId("not-shared")).toHaveAttribute(
    "title", "Not shared: on this project's list", { timeout: 20_000 },
  );
  // And it is on the list in Settings, where it can be taken off again.
  await tab.getByRole("button", { name: "Settings" }).click();
  await tab.getByTestId("settings-group-project").click();
  const list = tab.getByTestId("settings-not-shared");
  await expect(list.getByText("scratch/")).toBeVisible();
  await list.getByLabel("Add to what is not shared").fill("*.dat");
  await list.getByRole("button", { name: "Add" }).click();
  await expect(list.getByText("*.dat")).toBeVisible();
  await list.getByRole("button", { name: "Share scratch/ again" }).click();
  await expect(list.getByText("scratch/")).toHaveCount(0);
  await tab.keyboard.press("Escape");
  await expect(row("scratch").getByTestId("not-shared")).toHaveCount(0, { timeout: 20_000 });
});
