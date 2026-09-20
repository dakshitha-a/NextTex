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
  // Not the invite form, no member drawn, and the one way on is to keep
  // the copy as a project of this install's own.
  await expect(tab.getByTestId("make-invite")).toHaveCount(0);
  await expect(tab.getByTestId("member-row")).toHaveCount(0);
  await expect(tab.getByTestId("keep-as-own")).toBeVisible();
});

test("leaving keeps the copy as a project of its own", async ({ app, project, tab }) => {
  const base = `${app.base}/api/projects/${project.id}/collab`;
  expect((await tab.request.post(`${base}/share`, { data: { name: "Wilhelmina" } })).ok()).toBeTruthy();

  await tab.getByTestId("open-share").click();
  await tab.getByTestId("leave-share").click();
  const words = tab.getByTestId("leave-words");
  await expect(words).toContainText("Your copy stays on this computer");
  await tab.getByTestId("leave-delete").check();
  await expect(words).toContainText("Your copy on this computer is deleted");
  await tab.getByTestId("leave-delete").uncheck();
  await tab.getByTestId("confirm-leave").click();

  // Private again, in the same sheet, with the editor still underneath:
  // the one filled button offers an invite and there is nothing to stop.
  await expect(tab.getByTestId("share-panel")).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await expect(tab.getByTestId("make-invite")).toBeVisible();
  await expect(tab.getByTestId("leave-share")).toHaveCount(0);
  await expect(tab.locator(".cm-editor")).toBeVisible();
  const state = await (await tab.request.get(base)).json();
  expect(state.shared).toBe(false);
});

test("leaving and deleting the copy returns to the list without it", async ({
  app,
  project,
  tab,
}) => {
  const base = `${app.base}/api/projects/${project.id}/collab`;
  expect((await tab.request.post(`${base}/share`, { data: { name: "Wilhelmina" } })).ok()).toBeTruthy();

  await tab.getByTestId("open-share").click();
  await tab.getByTestId("leave-share").click();
  await tab.getByTestId("leave-delete").check();
  await tab.getByTestId("confirm-leave").click();

  await expect(tab.locator(".cm-editor")).toHaveCount(0, { timeout: 10_000 });
  await expect(tab.getByText("Projects", { exact: false }).first()).toBeVisible();
  const name = project.root.split("/").pop()!;
  await expect(tab.getByText(name, { exact: false })).toHaveCount(0);
  const listed = await (await tab.request.get(`${app.base}/api/projects`)).json();
  expect(listed.projects.some((p: { id: string }) => p.id === project.id)).toBe(false);
});

test("a removed install can keep its copy as a project of its own", async ({
  app,
  project,
  tab,
}) => {
  const base = `${app.base}/api/projects/${project.id}/collab`;
  const shared = await tab.request.post(`${base}/share`, { data: { name: "Wilhelmina" } });
  const me = (await shared.json()).me as string;
  await tab.request.delete(`${base}/member/${me}`);

  await tab.getByTestId("open-share").click();
  await expect(tab.getByTestId("removed-notice")).toBeVisible({ timeout: 10_000 });
  await tab.getByTestId("keep-as-own").click();
  await expect(tab.getByTestId("share-panel")).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await expect(tab.getByTestId("make-invite")).toBeVisible();
  await expect(tab.getByTestId("removed-notice")).toHaveCount(0);
});
