import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";
import { landed } from "../typing";

/** Two windows on one project.
 *
 *  This used to be the spec for the app's worst bug -- whole-file,
 *  last-writer-wins saves with nothing watching, so the second tab's
 *  autosave wrote its stale buffer over everything the first had written,
 *  silently, with the tab still showing clean.  The answer at the time was
 *  to *refuse* the second save and offer both copies back as a banner.
 *
 *  There is nothing left to refuse.  A file is a shared document and the two
 *  windows are two views of it, so this is now the spec for them agreeing:
 *  both people type, both keep what they typed, and nobody is asked to
 *  choose.  Nothing but a browser exercises this path.
 */

const SETTLE = 1500;

/** Open a file, and wait until this window is actually holding it.
 *
 *  `openProject` waits for the editor to mount, which happens whether or not
 *  a file has been opened in it -- and a window with no file open makes no
 *  connection to the shared documents at all, so it neither receives the
 *  other window's typing nor publishes a cursor of its own.  Half of these
 *  tests were failing on that and not on anything they were about.
 */
async function openMain(page: Page): Promise<void> {
  const row = page.getByRole("treeitem", { name: /main\.tex/ }).first();
  if (await row.count()) await row.click();
  else await page.getByText("main.tex", { exact: false }).first().click();
  await expect(page.locator(".cm-content")).toContainText("documentclass", {
    timeout: 20_000,
  });
}

async function secondWindow(app: any, project: any, browser: any): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${app.base}/?token=${app.token}`);
  await openProject(page, project.root);
  await openMain(page);
  return page;
}

async function typeAtStart(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type(text);
}

async function typeAtEnd(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("typing in one window appears in the other", async ({
  app, project, browser, tab,
}) => {
  await openMain(tab);
  const second = await secondWindow(app, project, browser);
  await typeAtStart(tab, "% written in the first window\n");

  await expect(second.locator(".cm-content")).toContainText(
    "written in the first window",
    { timeout: 15_000 },
  );
  await second.close();
});

test("both windows keep what they typed", async ({
  app, project, browser, tab,
}) => {
  // The case the banner existed for. Both type into the same file without
  // either having seen the other; both edits survive and no banner appears.
  await openMain(tab);
  const second = await secondWindow(app, project, browser);

  // Both near the top, because CodeMirror only renders the lines on screen:
  // text typed at the end of a long chapter is in the document and not in
  // the DOM, so asserting on `.cm-content` would fail for a reason that has
  // nothing to do with syncing. That the far end lands is covered by the
  // test below, which reads the file.
  await typeAtStart(tab, "% from the first window\n");
  await typeAtStart(second, "% from the second window\n");
  await tab.waitForTimeout(SETTLE);

  for (const page of [tab, second]) {
    await expect(page.locator(".cm-content")).toContainText(
      "from the first window", { timeout: 15_000 },
    );
    await expect(page.locator(".cm-content")).toContainText(
      "from the second window", { timeout: 15_000 },
    );
  }
  await second.close();
});

test("nobody is asked which copy to keep", async ({
  app, project, browser, tab,
}) => {
  await openMain(tab);
  const second = await secondWindow(app, project, browser);
  await typeAtStart(tab, "% one\n");
  await typeAtStart(second, "% two\n");
  await tab.waitForTimeout(SETTLE);

  for (const page of [tab, second]) {
    await expect(page.getByText(/changed somewhere else/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /keep what I typed/i }))
      .toHaveCount(0);
  }
  await second.close();
});

test("both windows' work reaches the file", async ({
  app, project, browser, tab,
}) => {
  await openMain(tab);
  const second = await secondWindow(app, project, browser);
  await typeAtStart(tab, "% first window on disk\n");
  await typeAtEnd(second, "\n% second window on disk\n");

  await landed(app, project, "first window on disk");
  await landed(app, project, "second window on disk");
  await second.close();
});

test("the other window is shown as being here", async ({
  app, project, browser, tab,
}) => {
  // Presence, from the writer's side: a second window is a second person as
  // far as the strip is concerned, which is exactly what makes it testable.
  await openMain(tab);
  const second = await secondWindow(app, project, browser);
  await second.locator(".cm-content").click();

  await expect(tab.getByTestId("collaborators")).toBeVisible({ timeout: 15_000 });
  await second.close();

  // And goes away again when they do, rather than leaving a ghost.
  await expect(tab.getByTestId("collaborators")).toHaveCount(0, { timeout: 20_000 });
});

test("a collaborator's caret is drawn where they are", async ({
  app, project, browser, tab,
}) => {
  await openMain(tab);
  const second = await secondWindow(app, project, browser);
  // At the top, so the caret is on a line both windows are showing.
  await second.locator(".cm-content").click();
  await second.keyboard.press("Control+Home");
  await second.keyboard.type("% where the other caret is");

  await expect(tab.locator(".cm-ySelectionCaret").first()).toBeVisible({
    timeout: 15_000,
  });
  await second.close();
});

test("a question typed in one window appears in the other, once", async ({
  app, project, browser, tab,
}) => {
  // R-053. The bubble was pushed by the composer that sent it rather than
  // by the event saying a turn had started, so the other window learned a
  // turn was running and had nothing to say was running: a spinner over a
  // blank panel, with no way to see what had been asked. The window that
  // asked still draws its own question immediately, because waiting for
  // the round trip is a visible delay on the writer's own typing, so the
  // fix has to be a bubble the event can adopt rather than duplicate.
  await openMain(tab);
  const other = await secondWindow(app, project, browser);

  for (const page of [tab, other]) {
    const composer = page.locator("textarea");
    if (!(await composer.isVisible())) {
      await page.keyboard.press("Control+Alt+a");
      await expect(composer).toBeVisible({ timeout: 20_000 });
    }
  }

  const asked = "What does a label do, exactly?";
  const composer = tab.locator("textarea");
  await composer.click();
  await composer.fill(`#script:reply\n${asked}`);
  await tab.getByRole("button", { name: "Send" }).click();

  await expect(other.getByText(asked, { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  // Once in each. The window that asked drew it, and the event must not
  // draw a second one beside it.
  for (const page of [tab, other]) {
    await expect(page.getByText(asked, { exact: false })).toHaveCount(1);
  }
  await other.close();
});
