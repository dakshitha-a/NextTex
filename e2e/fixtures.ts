import { test as base, type Page } from "@playwright/test";
import { startServer, seedProject, type Instance } from "./server";

type Fixtures = {
  app: Instance;
  project: { id: string; root: string };
  /** A browser tab already inside the project, with the token accepted. */
  tab: Page;
  /** Whether this test gets a NextTex of its own rather than the one its
   *  worker shares.  A spec that changes something the whole install
   *  holds, the agent provider, the writer's name, or that counts the rows
   *  of the projects screen, which on a shared server lists every other
   *  test's project too, sets `test.use({ ownServer: true })`. */
  ownServer: boolean;
};

type WorkerFixtures = {
  /** The NextTex this worker's tests share, held in a box so a server that
   *  has died can be replaced for the tests after it. */
  shared: { current: Instance | null };
};

/** Each worker starts one NextTex and every test it runs reuses it, which
 *  is most of what the browser tier used to spend: a server started and
 *  stopped per test, 619 times.  A test still seeds a project of its own,
 *  under a unique name, and still gets a fresh browser context, so what
 *  it writes to storage is its own. */
export const test = base.extend<Fixtures, WorkerFixtures>({
  ownServer: [false, { option: true }],
  shared: [
    async ({}, use) => {
      const box: { current: Instance | null } = { current: null };
      await use(box);
      await box.current?.stop();
    },
    { scope: "worker" },
  ],
  app: async ({ ownServer, shared }, use) => {
    if (ownServer) {
      const instance = await startServer();
      await use(instance);
      await instance.stop();
      return;
    }
    // Checked before each test: one server that fell over would otherwise
    // fail every test after it on this worker.
    if (!shared.current || !shared.current.alive()) {
      await shared.current?.stop().catch(() => undefined);
      shared.current = await startServer();
    }
    await use(shared.current);
  },
  project: async ({ app, ownServer }, use, info) => {
    const project = await seedProject(app, `p${info.workerIndex}-${Date.now()}`);
    await use(project);
    // On a shared server the project is forgotten once its test is over,
    // which closes its session.  Left open, as the server keeps an idle
    // project for half an hour, a worker's server was holding every
    // project its earlier tests had opened, each with its watcher and
    // its builds, and by the end of a run an outside write took longer
    // than a spec's wait to be noticed.
    if (!ownServer && app.alive()) {
      await fetch(`${app.base}/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { "x-nexttex-token": app.token },
      }).catch(() => undefined);
    }
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
