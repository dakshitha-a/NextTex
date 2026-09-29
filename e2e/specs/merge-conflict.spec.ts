import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** Two versions of a paragraph, kept by a merge, chosen in place.
 *
 *  A merge that found one paragraph changed on both sides keeps both
 *  between comment lines, which compile, and the editor draws those lines
 *  as a quiet bar: the sentence with "Keep both", each version's name with
 *  "Keep this one", the closing line hidden. The file here is written the
 *  way the merge writes it, from outside, as a pull would bring it.
 */

function conflict(id: string, first: string, second: string): string {
  return [
    `% NextTex: two versions of this paragraph were written apart. Keep one. {nexttex-conflict ${id}}`,
    `% Version from Alice {nexttex-conflict ${id} 1}`,
    first,
    "",
    `% Version from Bob {nexttex-conflict ${id} 2}`,
    second,
    "",
    `% End of the two versions {nexttex-conflict ${id} end}`,
  ].join("\n");
}

test("a paragraph kept twice is chosen with one click, and the file follows", async ({ tab, project }) => {
  await expect(tab.getByTestId("editor-host")).toHaveAttribute("data-shown", "main.tex", { timeout: 30_000 });
  const main = join(project.root, "main.tex");
  const text = [
    "\\documentclass{article}",
    "\\begin{document}",
    "",
    conflict("aaa111", "The cat sat quietly on the mat.", "A dog lay on the rug."),
    "",
    conflict("bbb222", "First ending.", "Second ending."),
    "",
    "\\end{document}",
    "",
  ].join("\n");
  writeFileSync(main, text);

  const heads = tab.getByTestId("conflict-head");
  await expect(heads).toHaveCount(2, { timeout: 30_000 });
  await expect(heads.first()).toContainText("Two versions of this paragraph were written apart.");
  const versions = tab.getByTestId("conflict-version");
  await expect(versions).toHaveCount(4);
  await expect(versions.nth(0)).toContainText("Version from Alice");
  await expect(versions.nth(1)).toContainText("Version from Bob");
  // The markers are never drawn as text.
  await expect(tab.locator(".cm-content")).not.toContainText("nexttex-conflict");

  // Keep Bob's in the first, both in the second.
  await tab.getByTestId("conflict-keep-this").nth(1).click();
  await expect(heads).toHaveCount(1);
  await tab.getByTestId("conflict-keep-both").click();
  await expect(heads).toHaveCount(0);

  await expect.poll(() => readFileSync(main, "utf-8"), { timeout: 15_000 }).toBe([
    "\\documentclass{article}",
    "\\begin{document}",
    "",
    "A dog lay on the rug.",
    "",
    "",
    "First ending.",
    "",
    "Second ending.",
    "",
    "",
    "\\end{document}",
    "",
  ].join("\n"));
});
