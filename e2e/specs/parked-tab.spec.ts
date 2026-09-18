import { test, expect } from "../fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A tab that is not in front still follows its file.
 *
 *  The collaboration binding watches the shared text only while its state
 *  is the one in the view, and a parked state came back showing what it
 *  showed when it was parked: an outside rewrite, an agent edit or a
 *  collaborator's typing in an open-but-not-in-front file was invisible,
 *  and the next remote change was then spliced into the wrong offsets.
 *  `frontend/src/panes/parked.ts` folds the shared text into the parked
 *  state as it comes back; this is the whole of that, in a browser.
 */

async function shown(tab: import("@playwright/test").Page): Promise<string> {
  return (await tab.locator(".cm-content").innerText()).replace(/\n/g, "|");
}

test("a file rewritten outside while its tab was parked comes back current, and stays in step", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "notes.tex"), "\\section{Notes}\nSome notes.\n");
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("Some notes");

  // main.tex is parked. Rewrite it in place from outside.
  const main = join(project.root, "main.tex");
  writeFileSync(main, "\\documentclass{article}\n\\begin{document}\nREWRITTEN OUTSIDE ONE\n\\end{document}\n");
  await tab.locator('[data-tab][data-path="main.tex"]').click();
  await expect.poll(() => shown(tab), { timeout: 15_000 }).toContain("REWRITTEN OUTSIDE ONE");

  // In front now: a second rewrite lands where it should, not spliced.
  writeFileSync(main, "\\documentclass{article}\n\\begin{document}\nREWRITTEN OUTSIDE TWO\n\\end{document}\n");
  await expect.poll(() => shown(tab), { timeout: 15_000 }).toContain("REWRITTEN OUTSIDE TWO");
  expect(await shown(tab)).not.toContain("ONE");

  // And typing into the file that came back reaches the disk whole.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("Typed after.");
  await expect.poll(() => readFileSync(main, "utf-8"), { timeout: 15_000 })
    .toContain("REWRITTEN OUTSIDE TWO\n\\end{document}\nTyped after.");
});

test("the agent's edit to a chapter that is open but not in front is there when the tab comes back", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "notes.tex"), "\\section{Notes}\nSome notes.\n");
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("Some notes");

  // The same road an agent edit takes into the shared document: the
  // file route, with main.tex parked.
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({
      path: "main.tex",
      text: "\\documentclass{article}\n\\begin{document}\nSAVED THROUGH THE ROUTE\n\\end{document}\n",
      compile: false,
    }),
  });
  await tab.locator('[data-tab][data-path="main.tex"]').click();
  await expect.poll(() => shown(tab), { timeout: 15_000 }).toContain("SAVED THROUGH THE ROUTE");
});
