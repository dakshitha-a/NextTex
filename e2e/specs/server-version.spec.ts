import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** A tab open across an update notices it.
 *
 *  On 27 October 2026 a laptop tab ran the interface it had loaded for
 *  nine hours against a server on a newer commit, and broke only at the
 *  first chunk the new build no longer had. The page now keeps the commit
 *  its first `/api/instance` answer named, and asks again when it comes
 *  back into view and when its event stream reconnects.
 */

/** Answer the real instance until `update` is called, then the same with
 *  another commit. */
async function updateAfterLoad(page: Page): Promise<() => Promise<void>> {
  let updated = false;
  let answered = 0;
  await page.route("**/api/instance", async (route) => {
    // The tab that reloads itself does so with a request of its own in
    // flight, and the response to it is disposed before it can be read:
    // that request belongs to a page that is gone, so it is let go.
    try {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: updated ? { ...body, head: "f".repeat(40) } : body });
    } catch {
      return;
    }
    answered += 1;
  });
  // Only once the page has its first answer, the commit it belongs to;
  // switching sooner made that first answer the new commit, and the spec
  // passed only on a retry.
  return async () => {
    await expect.poll(() => answered, { timeout: 10_000 }).toBeGreaterThan(0);
    updated = true;
  };
}

test("a tab in view says NextTex was updated and offers Reload", async ({ page, app, project }) => {
  const update = await updateAfterLoad(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(page.getByTestId("status-outdated")).toHaveCount(0);
  await update();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const notice = page.getByTestId("status-outdated");
  await expect(notice).toContainText("NextTex was updated", { timeout: 10_000 });
  await expect(notice.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("a tab out of view reloads itself", async ({ page, app }) => {
  const update = await updateAfterLoad(page);
  let loads = 0;
  page.on("load", () => (loads += 1));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await update();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(1);
});
