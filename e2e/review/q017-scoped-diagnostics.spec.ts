import { test } from "@playwright/test";
import { startServer } from "../server";
import { openProject, openFolders } from "../fixtures";
import { watchEvents } from "../events";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Q-017: does a chapter-only build keep another chapter's error?
 *
 *  Once a document's full build takes more than two seconds, a fast build
 *  compiles only the chapter being edited.  The probe of September 2026
 *  read that the session then replaces the document's whole list of
 *  diagnostics with that build's, so an error in one chapter would vanish
 *  when the writer types in another.  This drives exactly that: an error
 *  in chapter 00, a build that reports it, then a keystroke in chapter 01,
 *  and prints what the next build says and what the drawer holds.
 *
 *  The bench's chapters cite and refer to things they never define, which
 *  is 72,000 warnings a build; they are taken out of the copy so the
 *  events stay small.  Needs `NEXTTEX_THESIS` and a TeX on PATH. */

const THESIS = process.env.NEXTTEX_THESIS ?? "";

type Diagnostic = { file?: string; severity?: string; message?: string };
type Done = { type: string; scope?: string; diagnostics?: Diagnostic[]; outcome?: string };

test("an error in one chapter, after typing in another", async ({ page }) => {
  // A driver that skips reads as one that passed (Q-056), so a missing
  // project is a failure that says what to set.
  if (!THESIS) throw new Error("set NEXTTEX_THESIS to a bench project directory");
  test.setTimeout(900_000);
  const app = await startServer();
  const root = join(app.projects, "thesis");
  cpSync(THESIS, root, { recursive: true });
  rmSync(join(root, ".git"), { recursive: true, force: true });
  for (const name of readdirSync(join(root, "chapters"))) {
    const file = join(root, "chapters", name);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/, citing \\cite\{[^}]*\} and \\ref\{[^}]*\}/g, ""));
  }
  // A full build has to take more than two seconds for a fast build to be
  // scoped to one chapter; without the warnings this one takes less.  A
  // counting loop in the preamble costs about two seconds on every build.
  const main = join(root, "main.tex");
  writeFileSync(main, readFileSync(main, "utf8").replace(
    "\\begin{document}",
    "\\newcount\\probeN \\loop\\advance\\probeN by 1 \\ifnum\\probeN<9000000 \\repeat\n\\begin{document}",
  ));
  const added = await (await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: root }),
  })).json() as { id: string };
  const events = await watchEvents(app, added.id);
  const builds = () => events.payloads.filter((e) => e.type === "compile_done") as Done[];
  const errorsIn = (done: Done, file: string) =>
    (done.diagnostics ?? []).filter((d) => d.severity === "error" && d.file === file).length;
  const waitForBuild = async (after: number, label: string) => {
    const deadline = Date.now() + 300_000;
    while (builds().length <= after) {
      if (Date.now() > deadline) throw new Error(`no build finished: ${label}`);
      await page.waitForTimeout(250);
    }
    const done = builds()[builds().length - 1];
    console.log(`${label}: scope=${done.scope} outcome=${done.outcome}`,
      `errors in 00=${errorsIn(done, "chapters/00.tex")}`,
      `errors in 01=${errorsIn(done, "chapters/01.tex")}`,
      `all diagnostics=${(done.diagnostics ?? []).length}`);
    return done;
  };

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await waitForBuild(0, "FIRST BUILD");

  await openFolders(page, "chapters/00.tex");
  await page.getByText("00.tex", { exact: true }).first().click();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  let before = builds().length;
  await page.keyboard.type("\\probeundefinedcommand ");
  let done = await waitForBuild(before, "AFTER THE ERROR IN 00");
  while (errorsIn(done, "chapters/00.tex") === 0) {
    before = builds().length;
    done = await waitForBuild(before, "  AND AGAIN");
  }

  await page.getByText("01.tex", { exact: true }).first().click();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  before = builds().length;
  await page.keyboard.type("A new sentence in chapter one. ");
  await waitForBuild(before, "AFTER TYPING IN 01");
  await page.waitForTimeout(4000);
  const last = builds()[builds().length - 1];
  console.log("LAST BUILD:", `scope=${last.scope}`,
    `errors in 00=${errorsIn(last, "chapters/00.tex")}`);
  const drawer = await page.evaluate(() =>
    document.querySelectorAll(".cm-lintRange-error, .nx-diag-error, [data-severity='error']").length);
  console.log("ERROR MARKS ON THE PAGE:", drawer);
  events.stop();
  await app.stop();
});
