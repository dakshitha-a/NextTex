import { test as base, type Page } from "@playwright/test";
import { startServer, seedProject, type Instance } from "./server";

type Fixtures = {
  app: Instance;
  project: { id: string; root: string };
  /** A browser tab already inside the project, with the token accepted. */
  tab: Page;
};

export const test = base.extend<Fixtures>({
  app: async ({}, use) => {
    const instance = await startServer();
    await use(instance);
    await instance.stop();
  },
  project: async ({ app }, use, info) => {
    await use(await seedProject(app, `p${info.workerIndex}-${Date.now()}`));
  },
  tab: async ({ app, project, page }, use) => {
    // The token in the query string is how a first visit authenticates; the
    // app swaps it for a cookie and takes it back out of the address bar.
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await use(page);
  },
});

/** Open the folders on the way to a file, so its row is on screen.
 *
 *  A project opens with its tree collapsed now -- every time, deliberately,
 *  so the first thing a writer sees is the shape of the document rather
 *  than every file in it -- and five specs had been quietly relying on the
 *  old behaviour, where everything was open on arrival. They were not
 *  testing that; they were testing an upload, a search, a drag and a tab,
 *  and each of them happened to need a nested row to be visible first.
 *
 *  So this is what a person does, and the specs now say so: click the
 *  folder, then use the file. `aria-expanded` is what it asks, because the
 *  row carries it and a click on an already open folder would shut it. */
export async function openFolders(page: Page, filePath: string): Promise<void> {
  const parts = filePath.split("/").slice(0, -1);
  let prefix = "";
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const folder = page.locator(`[role="tree"] [data-path="${prefix}"]`);
    await folder.waitFor({ timeout: 15_000 });
    if ((await folder.getAttribute("aria-expanded")) !== "true") {
      await folder.click();
    }
    await page.waitForTimeout(120);
  }
}

export async function openProject(page: Page, root: string): Promise<void> {
  const name = root.split("/").pop()!;
  await page.getByText(name, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 20_000 });
}

export { expect } from "@playwright/test";
