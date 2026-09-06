import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The conversation panel, driven by a scripted stand-in.
 *
 *  The real agent needs an account, costs money and answers differently
 *  every time, so none of this had ever been exercised.  The stand-in
 *  replays a fixed list of steps through the same event queue, and its
 *  `edit` step performs a real write -- so the version, the rebuild, the
 *  chip and its undo all run for real.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("an answer streams in and stays in the transcript", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });
});

test("an edit lands in the file and offers to be undone", async ({
  app, project, tab,
}) => {
  await ask(tab, "edit", "Add a sentence above the equation.");
  await expect(tab.getByText("main.tex").first()).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () =>
        (
          await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
            headers: { "x-nexttex-token": app.token },
          }).then((r) => r.json())
        ).text,
      { timeout: 20_000 },
    )
    .toContain("A sentence the scripted agent inserted.");

  const undo = tab.getByRole("button", { name: /undo/i }).first();
  await expect(undo).toBeVisible({ timeout: 20_000 });
  await undo.click();

  await expect
    .poll(
      async () =>
        (
          await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
            headers: { "x-nexttex-token": app.token },
          }).then((r) => r.json())
        ).text,
      { timeout: 20_000 },
    )
    .not.toContain("A sentence the scripted agent inserted.");
});

test("an agent edit is a version of its own, kept apart from yours", async ({
  app, project, tab,
}) => {
  await ask(tab, "edit", "Add a sentence above the equation.");
  await expect
    .poll(
      async () => {
        const body = await fetch(
          `${app.base}/api/projects/${project.id}/history?path=main.tex`,
          { headers: { "x-nexttex-token": app.token } },
        ).then((r) => r.json());
        return body.versions.map((v: any) => v.by);
      },
      { timeout: 20_000 },
    )
    .toContain("claude");
});

test("a shell command asks first, and the buttons are not clickable instantly", async ({
  tab,
}) => {
  await ask(tab, "permission", "Run the command.");
  // By handle, not by name: the card shows its keyboard hint inside the
  // button once it has focus, so the accessible name changes under you.
  const allow = tab.getByTestId("allow");
  await expect(allow).toBeVisible({ timeout: 20_000 });
  // A card that appears under a moving cursor must not be answerable by the
  // click that was already on its way.
  await expect(allow).toBeDisabled();
  await expect(allow).toBeEnabled({ timeout: 5_000 });
  await allow.click();
  await expect(tab.getByText("Done.")).toBeVisible({ timeout: 20_000 });
});

test("a command that runs more than one command is never remembered", async ({
  tab,
}) => {
  await ask(tab, "shellsyntax", "Run the compound command.");
  await expect(
    tab.getByText("This one is asked every time"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(tab.getByTestId("always")).toHaveCount(0);
});

test("a second question while Claude is writing goes next, not nowhere", async ({
  tab,
}) => {
  await ask(tab, "slow", "The long one.");
  await expect(tab.getByText("Claude is writing")).toBeVisible({ timeout: 20_000 });
  const composer = tab.locator("textarea");
  await composer.fill("And then this one.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText("yours will go next")).toBeVisible();
});
