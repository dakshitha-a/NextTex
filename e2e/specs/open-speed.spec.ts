import { test, expect } from "../fixtures";
import { seedProject } from "../server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How long a file takes to have its text on screen.
 *
 *  Not a threshold -- `bench/` is where budgets live -- but a measurement
 *  that prints, because opening a project became noticeably slower when
 *  documents moved onto sockets and there was no number anywhere saying by
 *  how much.
 *
 *  The thing being timed is deliberately "text is visible", not "the editor
 *  is visible". The editor mounts immediately with an empty document and
 *  fills in when the socket has synced, so waiting for `.cm-editor` measures
 *  nothing a writer cares about.
 */
test("a file's text is on screen promptly", async ({ app, project, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const row = page.getByText(project.root.split("/").pop()!, { exact: false }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  const started = Date.now();
  await row.click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const mounted = Date.now() - started;

  await expect(page.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });
  const filled = Date.now() - started;

  console.log(
    `\n  editor mounted after ${mounted} ms; text on screen after ${filled} ms\n`,
  );
  expect(filled).toBeLessThan(15_000);
});

/** The same measurement on a thesis rather than a one-page note.
 *
 *  Forty chapters is the shape the bench uses and the shape the app is
 *  actually written on, and it is where a per-file cost shows up.
 */
test("a chapter of a forty-file thesis opens promptly too", async ({ app, page }) => {
  const project = await seedProject(app, `thesis-${Date.now()}`);
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  const paragraph =
    "The excited state is reached by a vertical transition, and the " +
    "wavepacket then moves on a surface it did not begin on.\n\n";
  for (let index = 0; index < 40; index += 1) {
    writeFileSync(
      join(project.root, "chapters", `${String(index).padStart(2, "0")}.tex`),
      `\\section{Chapter ${index}}\n\n${paragraph.repeat(120)}`,
    );
  }

  await page.goto(`${app.base}/?token=${app.token}`);
  const row = page.getByText(project.root.split("/").pop()!, { exact: false }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  const started = Date.now();
  await row.click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const mounted = Date.now() - started;
  await expect(page.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });
  const filled = Date.now() - started;

  console.log(
    `\n  forty files: editor mounted after ${mounted} ms; ` +
    `text on screen after ${filled} ms\n`,
  );
  expect(filled).toBeLessThan(15_000);
});
