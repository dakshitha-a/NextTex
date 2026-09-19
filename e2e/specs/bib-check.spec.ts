import { test, expect } from "../fixtures";

/** Bibliography checks while you type.
 *
 *  A `.bib` file gets rows in the drawer the way a `.tex` file gets chktex
 *  rows, and the rows follow the typing: fix the entry and the row leaves
 *  without reopening the file.  `@` at the start of a line completes the
 *  entry types with their required fields as tab stops, and
 *  `\bibliographystyle{` in a `.tex` file completes the styles this TeX
 *  has.
 */

const BIB = [
  "@article{knuth84,",
  "  author = {Donald E. Knuth},",
  "  title = {Literate programming},",
  "  year = {1984}",
  "}",
  "@article{knuth84,",
  "  author = {Donald E. Knuth},",
  "  title = {Literate programming},",
  "  journal = {The Computer Journal},",
  "  year = {1984}",
  "}",
  "",
].join("\n");

test("a .bib file's rows are in the drawer and leave as the entry is fixed", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "references.bib", text: BIB, compile: false, create: true }),
  });
  await tab.locator('[role="tree"] [data-path="references.bib"]').click();
  await expect(tab.locator(".cm-content")).toContainText("knuth84", { timeout: 15_000 });

  // F8 opens the drawer on the rows, which are the file's own.  The rows
  // arrive a moment after the file opens, and F8 with none does nothing.
  const drawer = tab.getByTestId("diagnostics");
  await expect(async () => {
    await tab.keyboard.press("F8");
    await expect(drawer).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 20_000 });
  await expect(drawer.getByText("@article knuth84 has no journal")).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByText(/knuth84 is defined again/)).toBeVisible();

  // Type the journal in, and the row goes without the file being reopened.
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+Home");
  await tab.keyboard.press("ArrowDown");
  await tab.keyboard.press("ArrowDown");
  await tab.keyboard.press("ArrowDown");
  await tab.keyboard.press("Home");
  await tab.keyboard.type("  journal = {The Computer Journal},\n");
  await expect(drawer.getByText("@article knuth84 has no journal")).toHaveCount(0, { timeout: 15_000 });
  await expect(drawer.getByText(/knuth84 is defined again/)).toBeVisible();

  // A new entry: @ at the start of a line offers the types, and the
  // snippet has the required fields.
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n@inp");
  const list = tab.locator(".cm-tooltip-autocomplete");
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(list.locator("li[aria-selected]")).toContainText("@inproceedings");
  await tab.waitForTimeout(400);
  await tab.keyboard.press("Tab");
  await expect(list).toHaveCount(0);
  await expect(editor).toContainText("booktitle = {");
  await expect(editor).toContainText("@inproceedings{key,");
});

test("\\bibliographystyle completes the styles this TeX has", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\bibliographystyle{pl");
  const list = tab.locator(".cm-tooltip-autocomplete");
  await expect(list).toBeVisible({ timeout: 15_000 });
  await expect(list).toContainText("plain");
});
