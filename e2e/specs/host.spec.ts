import { test, expect } from "../fixtures";

// A NextTex of its own: host mode is the whole install's, and a shared
// server holds every other test's projects and choices.
test.use({ ownServer: true });

/** The always-on host, as the direction page's "The always-on host, in
 *  settings" and "The host in the people drawer" draw it.
 *
 *  One install cannot pair with another inside a spec, since the browser
 *  tier's transport is in-process, so what is drawn here is one install's
 *  side of each: the switch and its code, a code that is not one, and a
 *  host's own row in its People drawer. The pairing and the keeping are
 *  driven between two installs in tests/api/test_host.py. */

async function openInstall(tab: import("@playwright/test").Page) {
  const cog = tab.getByTestId("appearance").first();
  if ((await cog.getAttribute("aria-expanded")) !== "true") await cog.click();
  await tab.getByTestId("settings-sheet").waitFor({ state: "visible", timeout: 10_000 });
  await tab.getByTestId("settings-group-install").click();
}

test("host mode hands out a code, and says what it keeps", async ({ tab }) => {
  await openInstall(tab);
  await expect(tab.getByTestId("host-code-row")).toHaveCount(0);
  await tab.getByTestId("host-switch").click();
  const code = tab.getByTestId("host-code");
  await expect(code).toHaveValue(/^nexttex-host-v1-/, { timeout: 15_000 });
  await expect(tab.getByTestId("host-kept")).toContainText("0 projects, in");
  await tab.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await tab.getByTestId("host-code-copy").click();
  await expect(tab.getByTestId("host-code-copy")).toHaveText("Copied");
  // Off again: the host's own rows go, the writer's list stays.
  await tab.getByTestId("host-switch").click();
  await expect(tab.getByTestId("host-code-row")).toHaveCount(0);
  await expect(tab.getByTestId("hosts-row")).toBeVisible();
});

test("a code that is not a host's is refused where it was typed", async ({ tab }) => {
  await openInstall(tab);
  await tab.getByTestId("host-add").click();
  await tab.getByTestId("host-add-code").fill("not a pairing code");
  await tab.getByTestId("host-pair").click();
  await expect(tab.getByTestId("host-error")).toHaveText("That does not look like a pairing code.");
  await expect(tab.getByTestId("hosts-list")).toHaveCount(0);
});

test("a host's own row says so in its People drawer", async ({ app, project, tab }) => {
  expect((await tab.request.post(`${app.base}/api/host`, { data: { on: true } })).ok()).toBeTruthy();
  const base = `${app.base}/api/projects/${project.id}/collab`;
  expect((await tab.request.post(`${base}/share`, { data: { name: "Lab node" } })).ok()).toBeTruthy();
  await tab.getByTestId("bar-people").click();
  await expect(tab.getByTestId("you-host")).toHaveText("host", { timeout: 10_000 });
  // Nobody else, so no "Always on" list and no switch to keep it on a host.
  await expect(tab.getByTestId("host-list")).toHaveCount(0);
  await expect(tab.getByTestId("keep-on-host")).toHaveCount(0);
  await tab.request.post(`${app.base}/api/host`, { data: { on: false } });
});
