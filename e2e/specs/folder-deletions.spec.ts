import { test, expect } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Four folders with open tabs deleted from the tree, one after another.
 *
 *  On 13 November 2026 the browser on dak-n4 logged React's "Maximum
 *  update depth exceeded" three seconds after four chapter folders were
 *  deleted through the tree, each holding open files and one a document
 *  the preview followed. Each delete closes its tabs twice over, once
 *  from the delete route's answer and once from the server's `gone`, and
 *  the two closes overlapped: each wrote the strip from what it had read
 *  before waiting on the editor, so a later close put back a tab an
 *  earlier one had taken away, and a file already gone could be left in
 *  front.
 */

const tabs = (tab: import("@playwright/test").Page) =>
  tab.locator("[data-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("data-path")));

test("deleting four open folders in a row leaves one tab and no loop", async ({
  project, tab,
}) => {
  const problems: string[] = [];
  tab.on("pageerror", (error) => problems.push(String(error)));
  tab.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const folders = ["ch1", "ch2", "ch3", "ch4"];
  for (const folder of folders) {
    mkdirSync(join(project.root, folder), { recursive: true });
    writeFileSync(join(project.root, folder, "a.tex"), `\\section{${folder} a}\nText of ${folder} a.\n`);
    writeFileSync(join(project.root, folder, "b.tex"), `\\section{${folder} b}\nText of ${folder} b.\n`);
  }
  // A document of its own in one of them, which the strip follows.
  writeFileSync(
    join(project.root, "ch2", "root.tex"),
    "\\documentclass{article}\n\\begin{document}\nThe second chapter on its own.\n\\end{document}\n",
  );
  const opened: string[] = ["main.tex"];
  for (const folder of folders) {
    await tab.locator(`[role="tree"] [data-path="${folder}"]`).click({ timeout: 20_000 });
    for (const name of folder === "ch2" ? ["a.tex", "b.tex", "root.tex"] : ["a.tex", "b.tex"]) {
      await tab.locator(`[role="tree"] [data-path="${folder}/${name}"]`).click();
      await expect(tab.locator(".cm-content")).toContainText(
        name === "root.tex" ? "on its own" : `Text of ${folder} ${name[0]}`,
      );
      opened.push(`${folder}/${name}`);
    }
  }
  expect(await tabs(tab)).toEqual(opened);
  await expect(
    tab.getByRole("group", { name: "Previewed documents" }).getByRole("button", { name: "root" }).first(),
  ).toBeVisible({ timeout: 30_000 });

  for (const folder of folders) {
    await tab.getByLabel(`Actions for ${folder}`).click();
    await tab.getByRole("button", { name: "Move folder to trash" }).click();
  }
  await expect.poll(() => tabs(tab), { timeout: 20_000 }).toEqual(["main.tex"]);
  // Past the three seconds the loop took to show on 13 November.
  await tab.waitForTimeout(4_000);
  expect(await tabs(tab)).toEqual(["main.tex"]);
  await expect(tab.locator(".cm-content")).toContainText("A document to start writing in");
  expect(problems.filter((p) => /Maximum update depth|#185/.test(p))).toEqual([]);
});

test("a storm of files written beside the project leaves the window working", async ({
  project, tab,
}) => {
  // The other time the loop showed, 29 October 2026: a calculation wrote
  // scratch files into the project for two hours, and a tab took the
  // storm of changes it caused.
  const problems: string[] = [];
  tab.on("pageerror", (error) => problems.push(String(error)));
  tab.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  mkdirSync(join(project.root, "calc"), { recursive: true });
  for (let round = 0; round < 30; round++) {
    for (let n = 0; n < 10; n++) {
      writeFileSync(join(project.root, "calc", `step${round}-${n}.out`), `step ${round} ${n}\n`);
    }
    if (round % 3 === 2) {
      writeFileSync(
        join(project.root, "calc", `report${round}.tex`),
        "\\documentclass{article}\n\\begin{document}\nReport.\n\\end{document}\n",
      );
    }
    await tab.waitForTimeout(100);
  }
  await tab.waitForTimeout(4_000);
  await expect(tab.locator(".cm-content")).toContainText("A document to start writing in");
  expect(problems.filter((p) => /Maximum update depth|#185/.test(p))).toEqual([]);
});
