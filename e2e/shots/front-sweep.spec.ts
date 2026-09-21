import { test } from "../fixtures";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

/** The front door's sweep: the projects screen and everything that opens
 *  over it, at the four widths and a phone, in both themes, into a folder
 *  a person looks through.  The companion of `sweep.spec.ts`, which walks
 *  the workspace; run by hand at a push, as that one is:
 *
 *      NEXTTEX_SWEEP_DIR=/tmp/front npx playwright test -c shots.config.ts shots/front-sweep.spec.ts
 *
 *  Not a check.  What a redesign gets wrong is the thing nobody asserted,
 *  and the front door has more states than the workspace: two views, six
 *  sheets, a menu, a hover card and a guide. */

const OUT = process.env.NEXTTEX_SWEEP_DIR ?? path.join(process.cwd(), "shots", "front");
const WIDTHS = [1600, 1300, 1000, 800, 390];
const THEMES = ["light", "dark"] as const;

function shot(page: Page, name: string, theme: string, width: number) {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({ path: path.join(OUT, `${name}--${theme}--${width}.png`) });
}

const escape = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
};

test("the projects screen and what opens over it", async ({ app, project, tab }) => {
  test.setTimeout(600_000);
  tab.setDefaultTimeout(8_000);
  // Rows in every state: two more projects beside the harness's, one
  // archived and one in the trash, and the harness's own shared.
  for (const [name, state] of [["thesis-2025", "archived"], ["aims-2023", "trashed"]] as const) {
    const root = `${project.root}-${name}`;
    if (!fs.existsSync(root)) fs.cpSync(project.root, root, { recursive: true });
    const added = await tab.request.post(`${app.base}/api/projects`, { data: { path: root } });
    const { id } = await added.json();
    await tab.request.post(`${app.base}/api/projects/${id}/state`, { data: { state } });
  }
  await tab.request.post(`${app.base}/api/projects/${project.id}/collab/share`, { data: {} });

  await tab.getByTestId("switch-project").click();
  await tab.getByText("Projects", { exact: true }).waitFor();

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await tab.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await tab.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
      await tab.reload();
      await tab.getByText("Projects", { exact: true }).waitFor();
      await tab.getByTestId("project-row").first().waitFor();
      await tab.waitForTimeout(600);
      const phone = width < 500;

      await tab.getByTestId("project-row").first().hover();
      await tab.waitForTimeout(250);
      await shot(tab, "01-list", theme, width);

      await tab.getByTestId("ways-open").click();
      await tab.waitForTimeout(250);
      await shot(tab, "02-ways", theme, width);
      await escape(tab);

      await tab.getByTestId("new-project").click();
      await tab.getByPlaceholder("What is it called?").fill("Nonadiabatic dynamics review");
      await tab.waitForTimeout(250);
      await shot(tab, "03-new", theme, width);
      await escape(tab);

      const row = tab.getByTestId("project-row").first();
      await row.hover();
      await row.getByTestId("row-share").click();
      await tab.getByTestId("share-panel").waitFor();
      await tab.waitForTimeout(250);
      await shot(tab, "04-share", theme, width);
      await escape(tab);

      // The agent control leaves the app bar on a phone; the sheet is
      // still reached from the settings sheet there.
      if (!phone) {
        await tab.getByTestId("set-up-agent").click();
        await tab.getByTestId("agent-sheet").waitFor();
        await tab.waitForTimeout(250);
        await shot(tab, "05-agent", theme, width);
        await escape(tab);
      }

      await tab.getByTestId("update-open").click();
      await tab.getByTestId("update-sheet").waitFor();
      await tab.waitForTimeout(400);
      await shot(tab, "06-update", theme, width);
      await escape(tab);

      await tab.getByTestId("report-problem").click();
      await tab.getByTestId("report-card").waitFor();
      await tab.waitForTimeout(400);
      await shot(tab, "07-report", theme, width);
      await escape(tab);

      if (await tab.getByTestId("about-screen").isVisible()) {
        // The guide is lazy: its chunk lands, then it arrives, so the wait
        // is longer than a menu's.
        await tab.getByTestId("about-screen").click();
        await tab.waitForTimeout(900);
        await shot(tab, "08-guide", theme, width);
        await escape(tab);
      }

      if (!phone) {
        await tab.getByTestId("password-nudge").hover();
        await tab.getByTestId("password-card").waitFor();
        await tab.waitForTimeout(250);
        await shot(tab, "09-lock", theme, width);
        await tab.mouse.move(400, 600);
      }

      await tab.getByTestId("appearance").click();
      await tab.getByTestId("settings-sheet").waitFor();
      await tab.waitForTimeout(300);
      await shot(tab, "10-settings", theme, width);
      await escape(tab);

      await tab.getByTestId("view-archived").click();
      await tab.getByTestId("project-row").first().hover();
      await tab.waitForTimeout(250);
      await shot(tab, "11-archived", theme, width);
      await tab.getByTestId("view-back").click();

      await tab.getByTestId("view-trash").click();
      await tab.getByTestId("project-row").first().hover();
      await tab.waitForTimeout(250);
      await shot(tab, "12-trash", theme, width);
      await tab.getByTestId("empty-trash").click();
      await tab.waitForTimeout(250);
      await shot(tab, "13-trash-confirm", theme, width);
      await tab.getByRole("button", { name: "Keep" }).click();
      await tab.getByTestId("view-back").click();
      await tab.waitForTimeout(200);
    }
  }
});
