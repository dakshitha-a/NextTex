import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** A past conversation can be continued, renamed and deleted: the rows
 *  are named, each has a More menu and the same menu at a right-click,
 *  and an open one has Continue at its foot (the direction page's "A past
 *  conversation can be continued"). */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

async function fileAway(page: Page) {
  await page.getByTestId("clear-chat").click();
  await page.getByTestId("clear-confirm").click();
}

test("a past conversation is continued and the current one is filed in its place", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({ timeout: 20_000 });
  await fileAway(tab);
  await ask(tab, "reply", "Now the methods section");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({ timeout: 20_000 });

  await tab.getByTestId("past-open").click();
  const row = tab.getByTestId("past-conversation").first();
  // Named from its first question.
  await expect(row).toContainText("What does a label do?");
  await row.getByRole("button", { name: /^What does a label do\? / }).click();
  const foot = tab.getByTestId("past-continue-foot");
  await expect(foot).toContainText("Files the current conversation away");
  await tab.getByTestId("past-continue").click();

  // Back in the live column, holding the conversation continued, with the
  // line that says so.
  await expect(tab.getByTestId("past-conversations")).toHaveCount(0);
  await expect(tab.getByTestId("continued")).toContainText("Continued. Claude remembers this conversation.");
  await expect(tab.getByText("What does a label do?").first()).toBeVisible();
  await expect(tab.getByText("Now the methods section")).toHaveCount(0);
  // A finished conversation, not one a restart cut off.
  await expect(tab.getByText(/interrupted when NextTex restarted/)).toHaveCount(0);

  // And the one it replaced is the one filed away now.
  await tab.getByTestId("past-open").click();
  await expect(tab.getByTestId("past-conversation")).toHaveCount(1);
  await expect(tab.getByTestId("past-conversation").first()).toContainText("Now the methods section");
});

test("a past conversation is renamed and deleted from its menu", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({ timeout: 20_000 });
  await fileAway(tab);
  await tab.getByTestId("past-open").click();
  const row = tab.getByTestId("past-conversation").first();
  await row.hover();
  await row.getByTestId("past-more").click();
  const menu = tab.getByTestId("past-menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open", "Continue this conversation", "Rename", "Delete",
  ]);
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const field = tab.getByTestId("past-rename");
  await field.fill("Labels and references");
  await field.press("Enter");
  await expect(tab.getByTestId("past-conversation").first()).toContainText("Labels and references");

  // A right-click opens the same menu.
  await tab.getByTestId("past-conversation").first().click({ button: "right" });
  await tab.getByTestId("past-menu").getByRole("menuitem", { name: "Delete" }).click();
  const confirm = tab.getByTestId("past-delete-confirm");
  await expect(confirm).toContainText("Claude Code keeps its own copy until it clears it.");
  await tab.getByTestId("past-delete-yes").click();
  await expect(tab.getByTestId("past-conversation")).toHaveCount(0);
  await expect(tab.getByText(/Nothing filed away yet/)).toBeVisible();
});

test("the Session view names the live conversation and what claude.ai calls it", async ({ tab }) => {
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({ timeout: 20_000 });
  await tab.getByTestId("session-open").click();
  const field = tab.getByTestId("session-name");
  await expect(field).toHaveAttribute("placeholder", "What does a label do?");
  await tab.getByTestId("session-remote").click();
  await expect(tab.getByTestId("session-remote-name")).toHaveText(/: What does a label do\?$/);
});
