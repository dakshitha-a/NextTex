import { test, expect } from "../fixtures";

/** The share panel on an install that has been put out of the share.
 *
 *  A second NextTex is not available inside one spec, so the removal is
 *  driven through the route: the tombstone lands in this install's own
 *  member record exactly as it does when it arrives through a peer's
 *  manifest, and the panel reads it from there.
 */

test("a removed install is told so, and the strip draws nobody", async ({
  app,
  project,
  tab,
}) => {
  const base = `${app.base}/api/projects/${project.id}/collab`;
  const shared = await tab.request.post(`${base}/share`, { data: { name: "Wilhelmina" } });
  expect(shared.ok()).toBeTruthy();
  const me = (await shared.json()).me as string;

  const removed = await tab.request.delete(`${base}/member/${me}`);
  expect(removed.ok()).toBeTruthy();
  expect((await removed.json()).removed).toBe(true);

  await tab.getByTestId("open-share").click();
  const notice = tab.getByTestId("removed-notice");
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice).toContainText("removed you from this project");
  await expect(notice).toContainText("Your copy stays on this machine");
  // Not the invite form, and no member drawn as away.
  await expect(tab.getByTestId("make-invite")).toHaveCount(0);
  await expect(tab.getByTestId("peer-away")).toHaveCount(0);
});
