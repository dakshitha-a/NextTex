import { test, expect } from "../fixtures";

/** The typeset page in a window of its own, for a second monitor.
 *
 *  Opened from the preview tab's menu.  What only a browser can say is
 *  that the new window holds the page and nothing else, that it opens on
 *  the document that was asked for, and that a build in the first window
 *  reaches it: the two are on the same event stream, and the page count
 *  in the second changes when the first grows the document.
 */

test("the page opens in its own window and follows the build in the first", async ({
  project, tab, context,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A built page first, so both windows have something to count.
  await expect(tab.getByTestId("page-number")).toBeVisible({ timeout: 60_000 });
  await expect(tab.locator("text=/of \\d+/").first()).toBeVisible();

  const opening = context.waitForEvent("page");
  await tab.locator('[data-preview-tab][data-path="main.tex"]').click({ button: "right" });
  await tab.getByRole("menuitem", { name: "Open in its own window" }).click();
  const page = await opening;
  await page.waitForLoadState();
  expect(new URL(page.url()).searchParams.get("page")).toBe(project.id);

  // The page, and nothing else: no editor, no rail, no agent.
  await expect(page.getByTestId("page-window")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("page-window-document")).toHaveText("main.tex");
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.locator('[role="tree"]')).toHaveCount(0);
  await expect(page.getByTestId("page-number")).toBeVisible({ timeout: 60_000 });
  const before = await page.locator("text=/of \\d+/").first().textContent();

  // Grow the document in the first window; the second redraws.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  // Before \end{document}, where pages can still grow.
  await tab.locator(".cm-line", { hasText: "\\end{document}" }).last().click();
  await tab.keyboard.press("Home");
  await tab.keyboard.type("\\clearpage\nA page of its own.\n\\clearpage\nAnd another.\n");
  await expect.poll(
    async () => page.locator("text=/of \\d+/").first().textContent(),
    { timeout: 60_000 },
  ).not.toBe(before);
  await page.close();
});
