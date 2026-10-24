import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The Claude session in the column: the foot's meters, the line a
 *  compaction leaves, the Session view, remote control's mark and the line
 *  a refused call leaves. The scripted stand-in plays what the real agent
 *  reads off the CLI, through the same events. */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("the foot says how full the conversation is and how much of the plan is used", async ({ tab }) => {
  await ask(tab, "session", "Put the fits side by side.");
  const foot = tab.getByTestId("agent-foot");
  await expect(foot.getByTestId("foot-context")).toHaveText(/Context 14%/, { timeout: 20_000 });
  await expect(foot.getByTestId("foot-limit")).toHaveText("5-hour limit 42%");
  // On a subscription the foot carries no dollars.
  await expect(foot).not.toContainText("$");
  await expect(tab.getByTestId("compacted")).toHaveText(
    "Earlier turns were summarized to make room. The conversation went from 61 to 14 per cent of the window.",
  );
});

test("the line a compaction left survives a reload", async ({ tab }) => {
  await ask(tab, "session", "Put the fits side by side.");
  await expect(tab.getByTestId("compacted")).toContainText("from 61 to 14", { timeout: 20_000 });
  await tab.reload();
  await expect(tab.getByTestId("compacted")).toContainText("from 61 to 14", { timeout: 20_000 });
});

test("the Session view names the session and opens remote control", async ({ tab }) => {
  await tab.getByTestId("session-open").click();
  const view = tab.getByTestId("session-view");
  await expect(view).toBeVisible();
  const name = view.getByTestId("session-name");
  await name.fill("thesis-ch3");
  await name.press("Enter");
  await expect(name).toHaveValue("thesis-ch3");

  await expect(tab.getByTestId("remote-mark")).toHaveCount(0);
  await view.getByTestId("session-remote").click();
  await expect(view.getByTestId("session-remote-state")).toContainText("Connected while this project is open.");
  await expect(view.getByRole("link", { name: "Open it on claude.ai" })).toBeVisible();

  await tab.getByTestId("session-back").click();
  await expect(tab.getByTestId("chat-stream")).toBeVisible();
  await expect(tab.getByTestId("session-open")).toBeFocused();
  await expect(tab.getByTestId("remote-mark")).toHaveText("Remote");

  // Kept for the project: a reload asks the server, which remembers.
  await tab.reload();
  await expect(tab.getByTestId("remote-mark")).toHaveText("Remote", { timeout: 20_000 });
  await tab.getByTestId("session-open").click();
  await expect(tab.getByTestId("session-name")).toHaveValue("thesis-ch3");
  await tab.getByTestId("session-remote").click();
  await tab.getByTestId("session-back").click();
  await expect(tab.getByTestId("remote-mark")).toHaveCount(0);
});

test("a refused call from a remote turn says why where a card would have been", async ({ tab }) => {
  await ask(tab, "session-remote", "Edit it.");
  await expect(tab.getByTestId("refused")).toHaveText(
    "Wanted to run a shell command. This project asks first about that, and a remote turn has nobody here to ask. Switch to Auto in NextTex to let it run.",
    { timeout: 20_000 },
  );
});

test("the chip says the position in the same words as the menu", async ({ tab }) => {
  await expect(tab.getByTestId("model-open")).toContainText("Asks first");
  await tab.getByTestId("model-open").click();
  for (const [id, words] of [["mode-ask", "Asks first"], ["mode-project", "Auto"], ["mode-all", "Auto, all"]]) {
    await expect(tab.getByTestId(id)).toContainText(words);
  }
});

test.describe("the point a conversation is summarized at", () => {
  test.use({ ownServer: true });

  test("is one value, in the Session view and in the settings sheet", async ({ tab }) => {
    await tab.getByTestId("session-open").click();
    const stepper = tab.getByTestId("session-compact");
    await expect(stepper).toContainText("60%");
    await stepper.getByRole("button", { name: "Later point" }).click();
    await expect(stepper).toContainText("70%");
    await tab.getByTestId("session-back").click();

    await tab.getByTestId("appearance").click();
    await tab.getByTestId("settings-group-install").click();
    await expect(tab.getByTestId("settings-compact")).toContainText("70%");
    await tab.getByTestId("settings-compact").getByRole("button", { name: "Earlier point" }).click();
    await expect(tab.getByTestId("settings-compact")).toContainText("60%");
  });
});

test("a page the agent publishes is a chip in the turn and a row in the Session view", async ({ tab }) => {
  await ask(tab, "page", "A page I can send Mira.");
  const chip = tab.getByTestId("page-chip");
  await expect(chip).toContainText("three-fits", { timeout: 20_000 });
  const opened = tab.context().waitForEvent("page");
  await chip.getByTestId("page-open").click();
  const page = await opened;
  await page.waitForLoadState();
  await expect(page.locator("table")).toContainText("Hexane");
  await page.close();

  await tab.getByTestId("session-open").click();
  const row = tab.getByTestId("session-page");
  await expect(row).toContainText("three-fits");
  await row.hover();
  await row.getByTestId("session-page-delete").click();
  await expect(tab.getByTestId("session-page")).toHaveCount(0);
  await expect(tab.getByTestId("session-pages")).toContainText("Nothing published yet.");
});
