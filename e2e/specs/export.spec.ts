import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";
import { ROOT, startServer, seedProject } from "../server";

/** Word, HTML and Markdown in the download menu, when pandoc is here.
 *
 *  The server is pointed at `tests/fake_pandoc.py` through
 *  `NEXTTEX_PANDOC`, the way the install spec points it at a fake tlmgr,
 *  so the rows and the download can be driven on a machine without
 *  pandoc; a second server with the seam unset and no pandoc on PATH
 *  shows the menu without the rows.
 */

test("with pandoc the menu offers three formats under each document, and one downloads", async ({
  page,
}, info) => {
  const log = join(info.outputPath(), "pandoc.jsonl");
  const app = await startServer({
    NEXTTEX_PANDOC: join(ROOT, "tests", "fake_pandoc.py"),
    NEXTTEX_FAKE_PANDOC_LOG: log,
  });
  try {
    const project = await seedProject(app, `export-${Date.now()}`);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

    await page.getByTestId("bar-download").click();
    const menu = page.getByTestId("download-panel");
    await expect(menu.getByTestId("download-pdf")).toHaveCount(1, { timeout: 10_000 });
    // Three chips on the document's own block, after its .pdf, each
    // showing the suffix that lands in the folder and naming the format
    // in its title; live once the document has built.
    await expect(menu.locator('[data-testid="download-row"][data-document="main.tex"]'))
      .toHaveAttribute("data-built", "true", { timeout: 60_000 });
    const chips = menu.getByTestId("download-export");
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText(".docx");
    await expect(chips.nth(0)).toHaveAttribute("title", "main.tex as Word");
    await expect(chips.nth(1)).toHaveText(".html");
    await expect(chips.nth(2)).toHaveText(".md");
    const row = menu.locator('[data-testid="download-row"][data-document="main.tex"]');
    await expect(row.getByTestId("download-pdf")).toHaveCount(1);
    await expect(row.getByTestId("download-export")).toHaveCount(3);

    const waiting = page.waitForEvent("download");
    await chips.nth(0).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe("main.docx");
    const saved = await download.path();
    expect(readFileSync(saved!, "utf8")).toContain("fake pandoc wrote docx");
    const argv = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!);
    expect(argv).toContain("--citeproc");
    expect(argv[argv.indexOf("-t") + 1]).toBe("docx");
    // Every figure became a picture, so nothing is said about them.
    await expect(page.getByTestId("notices")).toBeEmpty();
  } finally {
    await app.stop();
  }
});

test("a figure that could not become a picture is named in a notice after the download", async ({
  page,
}) => {
  const app = await startServer({ NEXTTEX_PANDOC: join(ROOT, "tests", "fake_pandoc.py") });
  try {
    const project = await seedProject(app, `export-figure-${Date.now()}`);
    // TeX skips the figure, since the file is not there, and still
    // builds; the fake pandoc, like the real one, hands it on to be found.
    const main = join(project.root, "main.tex");
    writeFileSync(
      main,
      readFileSync(main, "utf8").replace(
        "\\end{document}",
        "\\IfFileExists{nothere.png}{\\includegraphics{nothere}}{}\n\\end{document}",
      ),
    );
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

    await page.getByTestId("bar-download").click();
    const menu = page.getByTestId("download-panel");
    await expect(menu.locator('[data-testid="download-row"][data-document="main.tex"]'))
      .toHaveAttribute("data-built", "true", { timeout: 60_000 });
    const waiting = page.waitForEvent("download");
    await menu.getByTestId("download-export").nth(0).click();
    expect((await waiting).suggestedFilename()).toBe("main.docx");
    await expect(page.getByTestId("notices")).toContainText(
      "main.docx is saved. 1 figure could not be made into a picture and shows as its name: nothere (not found).",
    );
  } finally {
    await app.stop();
  }
});

test("without pandoc the drawer says nothing about the three formats", async ({ page }) => {
  // The seam unset, and a PATH with no pandoc on it: the plain machine.
  const app = await startServer({
    NEXTTEX_PANDOC: "",
    PATH: "/usr/bin:/bin",
  });
  try {
    const project = await seedProject(app, `noexport-${Date.now()}`);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("bar-download").click();
    const menu = page.getByTestId("download-panel");
    await expect(menu.getByTestId("download-pdf")).toHaveCount(1, { timeout: 10_000 });
    await expect(menu.getByTestId("download-export")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
