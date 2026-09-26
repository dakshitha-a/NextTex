import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The agent reads a file's comments and answers them in the thread.
 *
 *  Drawn on the direction page's "The backlog close-out", section 1: the
 *  two tools fold into one line in the chat, and the reply is a message in
 *  the thread under "Claude" in the pen's ink, which a collaborator sees
 *  like any other. The scripted stand-in calls the same session methods
 *  the model's tools do, so the thread is written for real.
 */

async function commentOnHexane(page: Page, body: string) {
  await expect(page.getByTestId("editor-host")).toHaveAttribute("data-shown", "main.tex", { timeout: 30_000 });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The fast component is 180 fs in hexane.");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "hexane".length; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+Alt+m");
  const composer = page.getByTestId("comment-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "Comment" }).fill(body);
  await page.keyboard.press("Control+Enter");
  await expect(composer).toHaveCount(0);
  await expect(page.locator(".cm-content .nx-comment")).toHaveText("hexane", { timeout: 10_000 });
}

test("asked to, the agent reads the comments and answers in the thread under its own name", async ({ tab }) => {
  await commentOnHexane(tab, "Cyclohexane, surely?");

  const ask = tab.getByRole("textbox", { name: /Ask Claude/ });
  await ask.fill("#script:comments\nAnswer the comments in main.tex.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText("There was one open thread.")).toBeVisible({ timeout: 20_000 });

  // The two calls read as one line, with what each was done to.
  await expect(
    tab.getByText("Read the comments on main.tex, replied to a comment on hexane"),
  ).toBeVisible();

  // The thread holds the reply, under Claude, in the pen's ink.
  await tab.locator(".nx-comment-gutter .nx-comment-icon").click();
  const thread = tab.getByTestId("comment-thread");
  await expect(thread.getByTestId("comment-message")).toHaveCount(2, { timeout: 10_000 });
  const who = thread.locator('[data-agent="true"]');
  await expect(who).toHaveText("Claude");
  const [ink, pen] = await who.evaluate((el) => {
    const probe = document.createElement("span");
    probe.className = "text-pen";
    el.parentElement!.appendChild(probe);
    const said = [getComputedStyle(el).color, getComputedStyle(probe).color];
    probe.remove();
    return said;
  });
  expect(ink).toBe(pen);
  await expect(thread).toContainText("The methods section and the 2019 notebook both say cyclohexane.");
  // A reply is words: the thread is still open, for a person to close.
  await expect(thread.getByTestId("comment-resolve")).toBeVisible();
  await tab.keyboard.press("Escape");

  // And the drawer counts it.
  await tab.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(tab.getByTestId("comments-panel")).toContainText("1 reply");
  // On one line, as the page draws it: with a count beside the name and
  // the time, each word wrapped in its own narrow column, "1 / reply",
  // "04:11 / AM", since the row's actions keep their width unseen.
  const meta = tab.locator(".nx-comment-row-meta").first();
  const height = (await meta.boundingBox())!.height;
  expect(height).toBeLessThan(30);
});
