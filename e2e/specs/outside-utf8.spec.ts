import { test, expect } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A file written from outside, with accented names in it, reaches the
 *  editor as written.
 *
 *  Reported by a writer's in-app agent: after an entry was appended to
 *  references.bib from outside and one of its lines then rewritten with
 *  "S\o{}ren" as "Søren", the editor showed "@articløidstrup2014improved,"
 *  and the abstract of the entry before it interleaved with fragments of
 *  the new one, while the file on disk was clean.  pycrdt indexes the
 *  shared text in UTF-8 bytes and the store's diff was in code points, so
 *  every splice after an accented letter landed early.  This is the whole
 *  path, watcher to screen, with the report's shape.
 */

const HEAD = [
  "@article{Martínez2020,",
  "  author = {Martínez and González and Bäuml},",
  "  title = {Ångström scale – a study},",
  "}",
  "@article{SubotnikARPC,",
  "  abstract = {Detailed balance is discussed briefly.},",
  "}",
];
const ENTRY = [
  "@article{Smidstrup2014improved,",
  "  author = {S\\o{}ren Smidstrup and J{\\'{o}}nsson},",
  "  year = {2014},",
  "}",
];

async function editorLines(tab: import("@playwright/test").Page) {
  return tab.locator(".cm-line").allTextContents();
}

test("an outside write after accented text lands where it was made", async ({ tab, project }) => {
  const path = join(project.root, "extra.bib");
  writeFileSync(path, HEAD.join("\n") + "\n");
  await expect(tab.getByRole("treeitem", { name: /extra\.bib/ })).toBeVisible({ timeout: 10_000 });
  await tab.getByRole("treeitem", { name: /extra\.bib/ }).click();
  await expect(tab.locator(".cm-line", { hasText: "SubotnikARPC" })).toBeVisible({ timeout: 10_000 });

  // Appended from outside, as the agent's add_reference does.
  writeFileSync(path, HEAD.join("\n") + "\n" + ENTRY.join("\n") + "\n");
  await expect(tab.locator(".cm-line", { hasText: "year = {2014}" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(editorLines.bind(null, tab), { timeout: 10_000 }).toEqual([...HEAD, ...ENTRY, ""]);

  // One line rewritten from outside, ASCII escapes to two-byte letters.
  const edited = ENTRY.map((line) => line.replace("S\\o{}ren Smidstrup and J{\\'{o}}nsson", "Søren Smidstrup and Jónsson"));
  writeFileSync(path, HEAD.join("\n") + "\n" + edited.join("\n") + "\n");
  await expect(tab.locator(".cm-line", { hasText: "Søren Smidstrup and Jónsson" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(editorLines.bind(null, tab), { timeout: 10_000 }).toEqual([...HEAD, ...edited, ""]);
  // And no fragment of one line inside another, which is what the
  // writer saw.
  const text = (await editorLines(tab)).join("\n");
  expect(text).not.toContain("articlø");
  expect(text).toContain("@article{Smidstrup2014improved,");
});
