import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";

/** Python scripts in the source pane.
 *
 *  The agent draws a figure by writing a script into `scripts/` and running
 *  it, and the README promised the writer could open that script and change
 *  it.  These specs are about the script being a file the editor treats as
 *  its own: it opens, it reads as Python, and the spell checker leaves it
 *  alone.
 */

const HELLO = `# A script the agent might have written.
def greet(name):
    return "hello " + name

print(greet("world"))
`;

async function withScript({ app, project, page }: any, body = HELLO) {
  mkdirSync(join(project.root, "scripts"), { recursive: true });
  writeFileSync(join(project.root, "scripts", "hello.py"), body);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await openFolders(page, "scripts/hello.py");
  await page.locator('[role="tree"] [data-path="scripts/hello.py"]').click();
  await expect(page.locator(".cm-content")).toContainText("def greet", { timeout: 15_000 });
}

test("a script opens in the editor and reads as Python", async ({ app, project, page }) => {
  await withScript({ app, project, page });
  // The keyword is a highlighted span of its own, which LaTeX never gave
  // it: as stex, `def` was prose.  A class name from the highlighter is
  // generated, so the assertion is that the token is wrapped at all.
  const keyword = page.locator(".cm-line span", { hasText: /^def$/ }).first();
  await expect(keyword).toBeVisible();
  const comment = page.locator(".cm-line span", { hasText: "A script the agent" }).first();
  await expect(comment).toBeVisible();
  // And it is live, not a read-only fallback: the tab is bound to a
  // shared document, so typing reaches the buffer.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nx = 1");
  await expect(page.locator(".cm-content")).toContainText("x = 1");
});
