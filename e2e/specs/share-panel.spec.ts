import { test, expect, openProject } from "../fixtures";
import { openPeople, shareProject, waitShared } from "../collab";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The People drawer: sharing, inviting, the members and their rows, and
 *  an install that has been put out of the share.
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

  await tab.getByTestId("bar-people").click();
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

  await tab.getByTestId("bar-people").click();
  await tab.getByTestId("leave-share").click();
  const words = tab.getByTestId("leave-words");
  await expect(words).toContainText("Your copy stays on this computer");
  await tab.getByTestId("leave-delete").check();
  await expect(words).toContainText("Your copy on this computer is deleted");
  await tab.getByTestId("leave-delete").uncheck();
  await tab.getByTestId("confirm-leave").click();

  // Private again, in the same drawer, with the editor still beside it:
  // the one filled button shares the project and there is nothing to stop.
  await expect(tab.getByTestId("share-panel")).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await expect(tab.getByTestId("share-start")).toBeVisible();
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

  await tab.getByTestId("bar-people").click();
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

  await tab.getByTestId("bar-people").click();
  await expect(tab.getByTestId("removed-notice")).toBeVisible({ timeout: 10_000 });
  await tab.getByTestId("keep-as-own").click();
  await expect(tab.getByTestId("share-panel")).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await expect(tab.getByTestId("share-start")).toBeVisible();
  await expect(tab.getByTestId("removed-notice")).toHaveCount(0);
});

test("the drawer shares the project, makes an invite, and lists the members", async ({ tab }) => {
  await tab.getByTestId("bar-people").click();
  const panel = tab.getByTestId("share-panel");
  await expect(panel).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  // Not shared: one filled button, and no invite control in the heading.
  await expect(tab.getByTestId("make-invite")).toHaveCount(0);
  await expect(tab.getByTestId("leave-share")).toHaveCount(0);
  await tab.getByTestId("share-start").click();
  await expect(panel).toHaveAttribute("data-state", "shared", { timeout: 10_000 });
  // The invite, the note, and the members with you first, in your file.
  const invite = tab.getByTestId("invite-text");
  await expect(invite).toBeVisible();
  const first = await invite.inputValue();
  expect(first).toMatch(/^nexttex-share-v1-/);
  await expect(panel.getByText("Expires in a week")).toBeVisible();
  const rows = panel.getByTestId("people-list").locator("li");
  await expect(rows.first()).toContainText("You");
  await expect(rows.first()).toContainText("main.tex");
  // The heading's plus makes another; the foot has the same, and Stop.
  await expect(tab.getByTestId("make-invite-foot")).toBeVisible();
  await expect(tab.getByTestId("leave-share")).toBeVisible();
  await tab.getByTestId("make-invite").click();
  await expect(invite).not.toHaveValue(first, { timeout: 10_000 });
});

test("a member's row says where they are, and Remove disconnects them", async ({
  app, project, tab, browser,
}) => {
  // A second install is not available inside one spec.  The member is
  // written into the share's record and the session reopened to read it,
  // and their presence is a second window whose cursor carries the same
  // name, which is how the drawer joins the two records.
  const base = `${app.base}/api/projects/${project.id}`;
  expect((await tab.request.post(`${app.base}/api/auth/name`, { data: { display_name: "Bob" } })).ok()).toBeTruthy();
  expect((await tab.request.post(`${base}/collab/share`, { data: { name: "Wilhelmina" } })).ok()).toBeTruthy();
  const record = join(project.root, ".nexttex", "collab", "share.json");
  const share = JSON.parse(readFileSync(record, "utf8"));
  share.members["b".repeat(64)] = { name: "Bob", at: 0 };
  writeFileSync(record, JSON.stringify(share));
  // Forgetting the project closes its session; registered again and
  // opened, its session reads the record with Bob in it.
  expect((await tab.request.delete(base)).ok()).toBeTruthy();
  expect((await tab.request.post(`${app.base}/api/projects`, { data: { path: project.root } })).ok()).toBeTruthy();
  await tab.goto(`${app.base}/?token=${app.token}`);
  // The app remembers the last project and goes back in; if the id
  // changed on the way it lands on the list instead.
  const editor = tab.locator(".cm-editor");
  await editor.or(tab.getByText("Projects", { exact: false }).first()).first().waitFor({ timeout: 30_000 });
  if (!(await editor.isVisible())) await openProject(tab, project.root);
  await expect(editor).toBeVisible({ timeout: 30_000 });

  const second = await browser.newPage();
  await second.goto(`${app.base}/?token=${app.token}`);
  await openProject(second, project.root);
  await expect(second.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await second.locator(".cm-content").click();
  // A move: the position is reported on a change, and a click that
  // leaves the caret where it was is not one.
  await second.keyboard.press("ArrowDown");

  // The faces at the strip's end open the drawer.
  await expect(tab.getByTestId("collaborators")).toBeVisible({ timeout: 15_000 });
  await tab.getByTestId("collaborators").click();
  const row = tab.getByTestId("member-row");
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await expect(row).toContainText("Bob");
  await expect(row.locator(".nx-person-what")).toContainText("main.tex", { timeout: 15_000 });
  // Remove is on the row's hover, and asks first.
  await row.hover();
  await row.getByTestId("member-remove").click();
  await expect(tab.getByTestId("confirm-remove")).toBeVisible();
  await tab.getByTestId("confirm-remove").click();
  await expect(tab.getByTestId("member-row")).toHaveCount(0, { timeout: 10_000 });
  await second.close();
});

test("a tab that reloads a shared project still knows it is shared", async ({
  app, project, tab,
}) => {
  // `collab_peers` is published when sharing begins and when a peer comes
  // or goes, and the store has no way to ask for it. So every reload of a
  // shared project drew the People drawer as a private one: no invite in
  // the heading, on a project with members in it. A tab whose EventSource
  // connected a moment after `begin_sharing` published had the same
  // nothing, which is why a share made by the route and read immediately
  // was a race the whole time. The stream sends the state as its second
  // frame now, the way it already sent the build state as its first.
  await shareProject(tab.request, app, project.id);
  await openPeople(tab);
  await waitShared(tab);

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await openPeople(tab);
  await waitShared(tab);
});
