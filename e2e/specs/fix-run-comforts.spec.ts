import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openFolders, openProject } from "../fixtures";
import { ROOT, seedProject, startServer } from "../server";

/** The fix run's tenth step: the looks brought back to the direction page,
 *  and the comfort features it drew (Q-045, Q-046, Q-047, Q-048, Q-057 to
 *  Q-061, Q-064, Q-065). */

async function readyMain(tab: Page) {
  await expect(tab.getByTestId("editor-host")).toHaveAttribute("data-shown", "main.tex", { timeout: 30_000 });
}

test("Back names the project it returns to, and a project can be duplicated", async ({ tab, project }) => {
  // Q-057 and Q-047.
  await readyMain(tab);
  await tab.getByTestId("switch-project").click();
  const name = project.root.split("/").pop()!;
  await expect(tab.getByTestId("back-to-project")).toHaveText(`Back to ${name}`);
  const row = tab.getByTestId("project-row").filter({ hasText: name }).first();
  await row.hover();
  await row.getByTestId("row-more").click();
  // The order drawn: the downloads, Duplicate, a rule, Archive, the trash.
  const items = await tab.getByTestId("row-menu").getByRole("menuitem").allTextContents();
  expect(items).toEqual(["Download as a zip", "Download the PDF", "Duplicate", "Archive", "Move to the trash"]);
  await tab.getByTestId("row-duplicate").click();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await tab.getByTestId("switch-project").click();
  await expect(tab.getByTestId("project-row").filter({ hasText: `${name} copy` })).toHaveCount(1);
});

test("the file menu ends with making, bringing in, and then what throws away", async ({ tab }) => {
  // Q-060.
  await readyMain(tab);
  await tab.getByLabel("Actions for main.tex").click();
  const labels = (await tab.getByTestId("file-menu").getByRole("button").allTextContents())
    .map((label) => label.replace(/(F2|Del|Ctrl H)$/, "").trim());
  const tail = labels.slice(-5);
  expect(tail).toEqual(["New file here", "New folder here", "Upload here", "Delete version history…", "Move to trash"]);
  expect(labels).not.toContain("Delete version history… History");
});

test("every choice in the composer menu has a ring, and the last position says what the other agents refuse", async ({ tab }) => {
  // Q-059 and Q-004.
  await tab.getByTestId("model-open").click();
  const rows = tab.getByTestId("composer-menu").getByRole("menuitemradio");
  expect(await rows.count()).toBeGreaterThan(2);
  for (const row of await rows.all()) {
    const ring = await row.evaluate((el) => getComputedStyle(el, "::before").boxShadow);
    expect(ring).toContain("inset");
  }
});

test("the upload sheet names the folder a drop went into", async ({ tab, project }) => {
  // Q-061: dropped on a folder, with a name already there.
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "plot.png"), "old");
  await readyMain(tab);
  await openFolders(tab, "figures/plot.png");
  const folder = tab.locator('[role="tree"] [data-path="figures"]');
  const buffer = await tab.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["new"], "plot.png", { type: "image/png" }));
    return data;
  });
  await folder.dispatchEvent("dragenter", { dataTransfer: buffer });
  await folder.dispatchEvent("dragover", { dataTransfer: buffer });
  await folder.dispatchEvent("drop", { dataTransfer: buffer });
  const sheet = tab.getByTestId("upload-staging");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.getByTestId("upload-into")).toHaveText("Into figures");
});

test("the word count stays on a 1440 pixel laptop, and the palette answers it", async ({ tab }) => {
  // Q-064.
  await tab.setViewportSize({ width: 1440, height: 900 });
  await readyMain(tab);
  await expect(tab.getByTestId("word-count")).toBeVisible({ timeout: 20_000 });
  await tab.keyboard.press("Control+k");
  await tab.getByTestId("palette-input").fill("Word count");
  await tab.getByTestId("palette-row").filter({ hasText: "Word count" }).first().click();
  await expect(tab.getByTestId("notices")).toContainText(/\d[\d,]* words in the document, [\d,]+ of them in main\.tex\./, {
    timeout: 15_000,
  });
});

test("what follows \\end{document} is in the third ink, and a line says why", async ({ tab }) => {
  // Q-065.
  await readyMain(tab);
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\section{Outlook}");
  await expect(tab.locator(".cm-content .nx-after-end").first()).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByTestId("after-end-note")).toHaveText(
    "TeX ignores everything below \\end{document}. Move these lines above it to have them typeset.",
  );
});

test("renaming a chapter offers to change what names it, once, in the row", async ({ tab, project }) => {
  // Q-045.
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "chapters", "one.tex"), "A chapter.\n");
  const main = join(project.root, "main.tex");
  writeFileSync(main, readFileSync(main, "utf-8").replace("\\end{document}", "\\input{chapters/one}\n\\end{document}"));
  await readyMain(tab);
  await openFolders(tab, "chapters/one.tex");
  await tab.getByLabel("Actions for one.tex").click();
  await tab.getByRole("button", { name: "Rename" }).click();
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type("intro.tex");
  await tab.keyboard.press("Enter");
  const asked = tab.getByTestId("rename-follow");
  await expect(asked).toContainText("1 file names chapters/one.tex. Change it to chapters/intro.tex?", { timeout: 15_000 });
  await tab.getByTestId("rename-follow-yes").click();
  await expect(asked).toHaveCount(0);
  await expect.poll(() => readFileSync(main, "utf-8"), { timeout: 15_000 }).toContain("\\input{chapters/intro}");
});

test("a comment can suggest the words, and Accept makes the change", async ({ tab, project }) => {
  // Q-046.
  await readyMain(tab);
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("Enter");
  await tab.keyboard.type("The fast component is 180 fs in hexane.");
  await tab.keyboard.press("ArrowLeft");
  for (let i = 0; i < "hexane".length; i += 1) await tab.keyboard.press("Shift+ArrowLeft");
  await tab.getByTestId("selection-actions").getByTestId("selection-comment").click();
  const composer = tab.getByTestId("comment-composer");
  await composer.getByRole("textbox", { name: "Comment" }).fill("Cyclohexane, surely?");
  await composer.getByTestId("comment-suggest").click();
  await composer.getByTestId("comment-suggestion").fill("cyclohexane");
  await tab.keyboard.press("Control+Enter");
  await expect(composer).toHaveCount(0);
  await tab.locator(".nx-comment-gutter .nx-comment-icon").last().click();
  const card = tab.getByTestId("comment-thread");
  await expect(card.getByTestId("comment-suggestion-shown")).toContainText("cyclohexane");
  await expect(card.getByTestId("comment-resolve")).toHaveCount(0);
  await card.getByTestId("comment-accept").click();
  await expect(tab.locator(".cm-content")).toContainText("180 fs in cyclohexane.", { timeout: 15_000 });
  await tab.getByTestId("bar-comments").click();
  // Resolved threads are the drawer's folded archive.
  await tab.getByTestId("comments-resolved").click();
  await expect(tab.getByTestId("comment-row")).toContainText("Accepted by you", { timeout: 10_000 });
  void project;
});

test("a commit offers the changes since it as a typeset PDF", async ({ page }) => {
  // Q-048, with the stand-in for latexdiff.
  const app = await startServer({ NEXTTEX_LATEXDIFF: join(ROOT, "tests", "fake_latexdiff.py") });
  try {
    const project = await seedProject(app, `changes-${Date.now()}`);
    const git = (...args: string[]) => execFileSync("git", args, {
      cwd: project.root, encoding: "utf-8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
    writeFileSync(join(project.root, ".gitignore"), "build/\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "submitted");
    const main = join(project.root, "main.tex");
    writeFileSync(main, readFileSync(main, "utf-8").replace("\\end{document}", "A sentence added since.\n\\end{document}"));
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await page.getByTestId("bar-git").click();
    const notNow = page.getByRole("button", { name: "Not now" });
    const row = page.getByTestId("git-commit").first();
    await expect(row.or(notNow)).toBeVisible({ timeout: 20_000 });
    if (await notNow.isVisible()) await notNow.click();
    await row.hover();
    const opened = page.context().waitForEvent("page");
    await row.getByTestId("git-changes-pdf").click();
    const tab = await opened;
    await tab.waitForURL(/\/git\/changes\/main-since-[0-9a-f]{7}\.pdf$/, { timeout: 60_000 });
  } finally {
    await app.stop();
  }
});
