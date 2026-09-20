import { test, expect } from "../fixtures";

/** One sheet, three doors.  "What writes with you" is reached from the
 *  app bar on the projects screen, from the settings sheet's Writing agent
 *  row and from the Claude column's own name, and it is the same dialog
 *  each way, so a writer who learns it once has learned it. */

const NAME = "What writes with you";

test("the settings row and the column's name open the same sheet inside a project", async ({ tab }) => {
  // From the column's header: the name is the control, with its chevron.
  const title = tab.getByTestId("agent-open");
  await expect(title).toHaveText(/Claude/);
  await expect(title).toHaveAttribute("aria-label", /Writing with Claude/);
  await title.click();
  const sheet = tab.getByRole("dialog", { name: NAME });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("agent-claude")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByTestId("claude-setup")).toContainText("Signed in");
  await sheet.getByTestId("agent-cancel").click();
  await expect(sheet).toHaveCount(0);
  // The column is still there, unfolded: the press was the name's, not
  // the header's fold.
  await expect(tab.getByTestId("chat-header")).toBeVisible();

  // From the settings sheet's row, which closes itself first.
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("settings-group-install").click();
  await tab.getByTestId("change-agent").click();
  await expect(tab.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("agent-confirm")).toHaveText("Keep Claude");
  await page_escape(tab);
  await expect(sheet).toHaveCount(0);
});

test("the rows are a radio group the arrow keys walk", async ({ tab }) => {
  await tab.getByTestId("agent-open").click();
  const sheet = tab.getByRole("dialog", { name: NAME });
  await sheet.getByTestId("agent-claude").focus();
  await tab.keyboard.press("ArrowDown");
  await expect(sheet.getByTestId("agent-openai")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByTestId("agent-openai")).toBeFocused();
  await expect(sheet.getByTestId("openai-key")).toBeVisible();
  await tab.keyboard.press("ArrowDown");
  await expect(sheet.getByTestId("agent-none")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByTestId("agent-confirm")).toHaveText("Use no agent");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("ArrowUp");
  await expect(sheet.getByTestId("agent-claude")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByTestId("agent-confirm")).toHaveText("Keep Claude");
});

async function page_escape(tab: import("@playwright/test").Page) {
  await tab.keyboard.press("Escape");
}
