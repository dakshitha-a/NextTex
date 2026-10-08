import { test, expect } from "../fixtures";
import type { Download, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { landed } from "../typing";
import { namesIn } from "../zip";

/** A file's history, downloaded as an audit trail, and the switch that
 *  stops the history thinning.
 *
 *  The writer asked for both on 7 October 2026 and chose where they live:
 *  the download in the file's menu and in the History drawer's heading,
 *  the switch at the drawer's foot and on This project, thinning still
 *  the default.  These drive each place and read back what arrived.
 */

async function typeAndSave(page: Page, text: string, app: any, project: any) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await landed(app, project, text);
}

async function openHistory(page: Page) {
  const drawer = page.getByTestId("drawer");
  await expect
    .poll(async () => {
      const showing =
        (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === "history";
      if (!showing) await page.getByTestId("bar-history").click();
      return showing;
    }, { timeout: 15_000, intervals: [400] })
    .toBe(true);
  await expect(page.getByTestId("version").first()).toBeVisible({ timeout: 10_000 });
}

function namesOf(download: Download): Promise<string[]> {
  return (async () => {
    expect(await download.failure()).toBeNull();
    return namesIn(readFileSync((await download.path())!));
  })();
}

test("the History drawer downloads the file's history as a ZIP", async ({ tab, app, project }) => {
  await typeAndSave(tab, "the first draft of the chapter", app, project);
  await openHistory(tab);

  const waiting = tab.waitForEvent("download");
  await tab.getByTestId("history-export").click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("main.tex-history.zip");
  const names = await namesOf(download);
  expect(names).toEqual(expect.arrayContaining(["log.csv", "log.json", "SHA256SUMS", "report.html"]));
  expect(names.some((name) => /^versions\/0001_.*_main\.tex$/.test(name))).toBe(true);

  // Only while one file is shown: the trail is a file's.
  await tab.getByTestId("history-toolbar").getByRole("button", { name: "Whole project" }).click();
  await expect(tab.getByTestId("history-export")).toHaveCount(0);
});

test("a file's menu downloads its history without opening the drawer", async ({ tab, app, project }) => {
  await typeAndSave(tab, "a line worth keeping", app, project);
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.getByLabel("Actions for main.tex").click();
  const menu = tab.getByTestId("file-menu");
  // In the group about the file's past, right after History.
  const items = await menu.getByRole("button").allInnerTexts();
  expect(items.indexOf("Download history")).toBe(items.indexOf("History") + 1);

  const waiting = tab.waitForEvent("download");
  await menu.getByRole("button", { name: "Download history" }).click();
  const names = await namesOf(await waiting);
  expect(names).toContain("SHA256SUMS");
});

test("Keep every version is off by default and is one setting in two places", async ({
  tab, app, project,
}) => {
  await typeAndSave(tab, "text", app, project);
  await openHistory(tab);
  const foot = tab.getByTestId("history-keep-all");
  const toggle = tab.getByTestId("history-keep-all-switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(foot).toContainText("Older versions thin");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(foot).toContainText("Typing within 90 seconds is still one version");
  await expect
    .poll(() => readFileSync(join(project.root, "nexttex.toml"), "utf8"), { timeout: 10_000 })
    .toContain("keep_all_versions = true");

  // The settings sheet's This project group shows the same switch, and
  // turning it off there reaches the drawer.
  await tab.getByTestId("appearance").first().click();
  const sheet = tab.getByRole("dialog", { name: "Settings" });
  await sheet.getByTestId("settings-group-project").click();
  const row = sheet.getByTestId("settings-keep-all");
  await expect(row).toHaveAttribute("aria-checked", "true");
  await row.click();
  await expect(row).toHaveAttribute("aria-checked", "false");
  await tab.getByTestId("settings-close").click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});
