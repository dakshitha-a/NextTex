import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Getting back what you had.
 *
 *  These are the app's promise that nothing is ever really lost, and both
 *  of them are almost entirely browser code.
 */

async function typeAndSave(page: Page, text: string) {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/file") && r.request().method() === "PUT",
    { timeout: 15_000 },
  );
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await saved;
}

async function openHistory(page: Page) {
  await page.getByLabel("Actions for main.tex").click();
  await page.getByRole("tree").getByRole("button", { name: "History" }).click();
  await expect(page.getByTestId("version").first()).toBeVisible({
    timeout: 10_000,
  });
}

test("every save is a version, and an old one can be read", async ({ tab }) => {
  await typeAndSave(tab, "the first draft");
  // Past the coalescing window would take ninety seconds; two saves from
  // one window inside it are deliberately one version, so this asserts what
  // the app promises rather than what would be convenient.
  await openHistory(tab);
  const rows = tab.getByTestId("version");
  await expect(rows.first()).toBeVisible();

  await rows.last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
});

test("a version being read cannot be typed into", async ({ app, project, tab }) => {
  await typeAndSave(tab, "the draft as it was");
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();

  // Read-only three separate ways, and this is the one the browser
  // enforces: the content is not editable at all.
  await expect(tab.locator(".cm-content")).toHaveAttribute(
    "contenteditable", "false",
  );
  await tab.locator(".cm-content").click({ position: { x: 30, y: 20 } });
  await tab.keyboard.type("THIS MUST NOT BE SAVED");
  await tab.waitForTimeout(1_200);        // past the autosave, deliberately
  await expect(tab.locator(".cm-content")).not.toContainText(
    "THIS MUST NOT BE SAVED",
  );

  const file = await fetch(
    `${app.base}/api/projects/${project.id}/file?path=main.tex`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());
  expect(file.text).not.toContain("THIS MUST NOT BE SAVED");
});

test("coming back from a version restores the live buffer, editable", async ({
  tab,
}) => {
  await typeAndSave(tab, "the live text");
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();

  await tab.getByRole("button", { name: /back to now/i }).click();
  await expect(tab.getByText(/viewing/i)).toHaveCount(0);
  await expect(tab.locator(".cm-content")).toContainText("the live text");
});

test("a deleted file goes to the trash and comes back byte for byte", async ({
  app, project, tab,
}) => {
  const before = await fetch(
    `${app.base}/api/projects/${project.id}/file?path=references.bib`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());

  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await expect(tab.getByTestId("trash-entry")).toHaveCount(0);

  await tab.getByRole("button", { name: /deleted/ }).click();
  const entry = tab.getByTestId("trash-entry").filter({ hasText: "references" });
  await expect(entry).toBeVisible({ timeout: 10_000 });

  await entry.hover();
  await entry.getByRole("button", { name: "Restore" }).click();

  await expect
    .poll(
      async () => {
        const back = await fetch(
          `${app.base}/api/projects/${project.id}/file?path=references.bib`,
          { headers: { "x-nexttex-token": app.token } },
        ).then((r) => r.json());
        return back.text;
      },
      { timeout: 15_000 },
    )
    .toBe(before.text);
});

test("emptying the trash asks before it destroys anything", async ({ tab }) => {
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await tab.getByRole("button", { name: /deleted/ }).click();

  const entry = tab.getByTestId("trash-entry").first();
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await entry.hover();
  await entry.getByRole("button", { name: "Delete" }).click();
  // Nothing is destroyed on one click: the trash is the last copy there is.
  await expect(entry.getByText("For good?")).toBeVisible();
  await entry.getByRole("button", { name: "Keep" }).click();
  await expect(entry).toBeVisible();
});
