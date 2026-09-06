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

export async function openProject(page: Page, root: string): Promise<void> {
  const name = root.split("/").pop()!;
  await page.getByText(name, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 20_000 });
}

export { expect } from "@playwright/test";
