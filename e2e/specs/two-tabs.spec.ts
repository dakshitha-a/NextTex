import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** Two windows on one project.
 *
 *  This is the spec for the app's worst bug: whole-file, last-writer-wins
 *  saves with nothing watching, so the second tab's autosave wrote its
 *  stale buffer over everything the first had written -- silently, with the
 *  tab still showing clean.  Nothing but a browser exercises this path.
 */

async function replaceAll(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
}

/** Run `work` while `page` is holding unsaved changes.
 *
 *  The autosave is a debounce, so typing more often than its quarter second
 *  keeps the buffer dirty for as long as this needs -- which is what makes
 *  the race deterministic rather than a 250 ms window to aim at.
 */
async function holdingUnsavedWork(page: Page, work: () => Promise<void>) {
  let done = false;
  await page.locator(".cm-content").click();
  const keepTyping = (async () => {
    while (!done) {
      await page.keyboard.type("x");
      await page.waitForTimeout(100);
    }
  })();
  try {
    await work();
  } finally {
    done = true;
    await keepTyping;
  }
}

async function saved(page: Page, action: Promise<void>) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/file") && r.request().method() === "PUT",
    { timeout: 15_000 },
  );
  await action;
  return (await response).json();
}

function readFile(app: { base: string; token: string }, id: string) {
  return fetch(`${app.base}/api/projects/${id}/file?path=main.tex`, {
    headers: { "x-nexttex-token": app.token },
  }).then((r) => r.json());
}

async function secondWindow(app: any, project: any, browser: any): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${app.base}/?token=${app.token}`);
  await openProject(page, project.root);
  return page;
}

test("a save in one tab reaches the other", async ({ app, project, browser, tab }) => {
  const second = await secondWindow(app, project, browser);
  await saved(tab, replaceAll(tab, "written in the first window"));

  // The second tab is clean, so it takes the newer text rather than sitting
  // on a stale buffer it would later write straight back over the top.
  await expect(second.locator(".cm-content")).toContainText(
    "written in the first window",
    { timeout: 15_000 },
  );
  await second.close();
});

test("a stale tab is told rather than allowed to overwrite", async ({
  app, project, browser, tab,
}) => {
  const second = await secondWindow(app, project, browser);
  await holdingUnsavedWork(second, async () => {
    await saved(tab, replaceAll(tab, "what the first window saved"));
  });

  await expect(second.getByText("changed somewhere else")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    second.getByRole("button", { name: "Keep what I typed" }),
  ).toBeVisible();
  expect((await readFile(app, project.id)).text).toBe("what the first window saved");
  await second.close();
});

test("keeping what you typed writes it, deliberately", async ({
  app, project, browser, tab,
}) => {
  const second = await secondWindow(app, project, browser);
  await holdingUnsavedWork(second, async () => {
    await saved(tab, replaceAll(tab, "the first window got there first"));
  });
  await second.getByRole("button", { name: "Keep what I typed" }).click({
    timeout: 20_000,
  });
  await expect(second.getByText("changed somewhere else")).toBeHidden();

  await expect
    .poll(async () => (await readFile(app, project.id)).text, { timeout: 15_000 })
    .toContain("x");
  expect((await readFile(app, project.id)).text).not.toContain(
    "the first window got there first",
  );
  await second.close();
});

test("taking the saved file gives up this tab's copy, and says so", async ({
  app, project, browser, tab,
}) => {
  const second = await secondWindow(app, project, browser);
  await holdingUnsavedWork(second, async () => {
    await saved(tab, replaceAll(tab, "the version that wins"));
  });
  await second.getByRole("button", { name: "Use the saved file" }).click({
    timeout: 20_000,
  });
  await expect(second.locator(".cm-content")).toContainText("the version that wins");
  expect((await readFile(app, project.id)).text).toBe("the version that wins");
  await second.close();
});

test("neither window's work becomes unrecoverable", async ({
  app, project, browser, tab,
}) => {
  const second = await secondWindow(app, project, browser);
  await holdingUnsavedWork(second, async () => {
    await saved(tab, replaceAll(tab, "the first window's paragraph"));
  });
  await second.getByRole("button", { name: "Keep what I typed" }).click({
    timeout: 20_000,
  });

  const versions = await fetch(
    `${app.base}/api/projects/${project.id}/history?path=main.tex`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());
  const texts = await Promise.all(
    versions.versions.map((v: any) =>
      fetch(
        `${app.base}/api/projects/${project.id}/history/blob` +
          `?path=main.tex&sha=${v.sha}`,
        { headers: { "x-nexttex-token": app.token } },
      )
        .then((r) => r.json())
        .then((b) => b.text),
    ),
  );
  expect(texts).toContain("the first window's paragraph");
  await second.close();
});
