import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Citation completion after a comma, by author and title, from the
 *  document's own bibliography.
 *
 *  The list treated everything inside the braces as one key, so after
 *  `\cite{knuth1984,` nothing matched and the list stayed shut; it matched
 *  the key alone, so a surname or a title word found nothing; and it
 *  offered every `.bib` in the project. The template's `main.tex` reads
 *  `references.bib`; `other.bib` sits beside it, read by nothing. */
test("citations complete after each comma, by author and title, from the linked .bib", async ({
  app, project, page,
}) => {
  appendFileSync(join(project.root, "references.bib"), [
    "",
    "@book{lamport1994,",
    "  author = {Lamport, Leslie},",
    "  title  = {LaTeX: a document preparation system},",
    "  year   = {1994},",
    "}",
    "@article{okafor2020,",
    "  author = {Lambert, Ada and Okafor, Chidi},",
    "  title  = {Conical intersections},",
    "  year   = {2020},",
    "}",
    "",
  ].join("\n"));
  writeFileSync(
    join(project.root, "other.bib"),
    "@misc{lagrange1788,\n  author = {Lagrange, Joseph-Louis},\n  title = {Mechanique analitique},\n  year = {1788},\n}\n",
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // The document builds once, so the owners map knows what main.tex reads.
  await expect(page.locator(".cm-content")).toContainText("\\cite{knuth1984}", { timeout: 30_000 });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");

  const list = page.locator(".cm-tooltip-autocomplete");
  const labels = list.locator(".cm-completionLabel");
  // A comma and a space open the list for the next key, unasked, and the
  // key already there is not offered again.
  await page.keyboard.type("As shown~\\cite{knuth1984, ");
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(labels).toHaveText(["lamport1994", "okafor2020"]);
  // Nothing from a bibliography the document does not read.
  await expect(list).not.toContainText("lagrange1788");

  // "la" starts one key and one surname: the key first.
  await page.keyboard.type("la");
  await expect(labels).toHaveText(["lamport1994", "okafor2020"]);
  await expect(list.locator("li").nth(1).locator(".cm-completionDetail")).toHaveText("Lambert, Okafor 2020");
  await expect(list.locator("li").nth(1).locator(".cm-completionDetail .cm-completionMatchedText")).toHaveText("La");

  // A word of a title finds its entry, and says so beside it.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("conic");
  await expect(labels).toHaveText(["okafor2020"]);
  await expect(list.locator(".cm-completionDetail")).toHaveText("Lambert 2020, Conical intersections");
  await expect(list.locator("li[aria-selected=true]")).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" shows it.");
  await expect(page.locator(".cm-activeLine")).toHaveText("As shown~\\cite{knuth1984, okafor2020} shows it.");

  // Taken in the middle of a list, a key adds no stray brace.
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("\\cite{,okafor2020}");
  for (let i = 0; i < ",okafor2020}".length; i += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("lamp");
  await expect(labels).toHaveText(["lamport1994"]);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-activeLine")).toHaveText("\\cite{lamport1994,okafor2020}");
});
