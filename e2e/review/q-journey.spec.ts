import { test } from "../fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Phase 5 of the September 2026 probe: a stretch of ordinary writing.
 *
 *  Not a check.  Each step is what a writer does in a week of a paper,
 *  timed from the act to what it should produce, and photographed into
 *  `NEXTTEX_JOURNEY_DIR`.  A step that cannot be done the way a writer
 *  would try first prints so and moves on, since that is the finding. */

const OUT = process.env.NEXTTEX_JOURNEY_DIR ?? join(process.cwd(), "shots", "journey");
mkdirSync(OUT, { recursive: true });

async function step(page: Page, name: string, act: () => Promise<unknown>) {
  const t = Date.now();
  try {
    await act();
    console.log(`STEP ${name}: ${Date.now() - t} ms`);
  } catch (error) {
    console.log(`STEP ${name}: could not, after ${Date.now() - t} ms: ${String(error).split("\n")[0]}`);
  }
  const empty = await page.getByText("Nothing has been typeset yet.").isVisible().catch(() => false);
  if (empty) console.log(`     ${name}: the preview says nothing has been typeset`);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test("a week of a paper, in one sitting", async ({ app, page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  await step(page, "01-new-article", async () => {
    await page.getByRole("button", { name: "New project" }).first().click();
    const sheet = page.getByTestId("new-project-sheet").or(page.getByRole("dialog")).first();
    await sheet.getByPlaceholder(/Where to put it/).fill(`${app.projects}/solvent-paper`);
    await sheet.getByRole("button", { name: "Create project" }).click();
    await page.locator(".cm-content").waitFor({ timeout: 30_000 });
    await page.locator(".nx-page").first().waitFor({ timeout: 60_000 });
  });

  const editor = page.locator(".cm-content").first();
  await step(page, "02-write-a-section", async () => {
    await editor.click();
    // Above \end{document}: the file ends with it and a newline, and text
    // typed after it is ignored by TeX without a word.
    await page.keyboard.press("Control+End");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Home");
    await page.keyboard.type("\\section{Solvent effects}\\label{sec:solvent}\nThe decay is fastest in water, as Section~\\ref{sec:");
    await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type(" shows.\n\n");

  await step(page, "03-an-error", async () => {
    await page.keyboard.type("\\begin{itemize}\n\\item one\n");
    await page.getByTestId("status").getByText(/error/i).waitFor({ timeout: 30_000 });
  });

  await step(page, "04-go-to-the-error", async () => {
    await page.keyboard.press("F8");
    await page.waitForTimeout(500);
  });

  await step(page, "05-fix-it", async () => {
    await page.keyboard.type("\\end{itemize}\n");
    await page.getByTestId("status").getByText(/error/i).waitFor({ state: "detached", timeout: 30_000 });
  });

  await step(page, "06-word-count", async () => {
    await page.getByTestId("word-count").click({ timeout: 5000 });
    await page.waitForTimeout(400);
  });
  await page.keyboard.press("Escape");

  await step(page, "07-find-across-files", async () => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.type("decay");
    await page.getByTestId("search-hit").first().waitFor({ timeout: 10_000 });
  });

  await step(page, "08-history", async () => {
    await page.getByTestId("bar-history").click();
    await page.waitForTimeout(800);
  });

  await step(page, "09-download-pdf", async () => {
    await page.getByTestId("bar-download").click();
    await page.waitForTimeout(800);
  });

  await step(page, "10-new-application", async () => {
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByTestId("template-application").click();
    await page.getByPlaceholder(/Where to put it/).fill(`${app.projects}/acme-postdoc`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.locator(".cm-content").waitFor({ timeout: 30_000 });
    await page.locator(".nx-page").first().waitFor({ timeout: 60_000 });
  });

  await step(page, "11-open-the-posting", async () => {
    await page.getByRole("treeitem", { name: /posting\.md/ }).click();
    await page.waitForTimeout(1000);
  });
});
