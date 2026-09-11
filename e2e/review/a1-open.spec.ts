import { test, expect } from "../fixtures";
import * as fs from "node:fs";
import * as path from "node:path";

/** What the preview says in the first half minute of a project. */
test("opening a project, second by second", async ({ app, project, tab }) => {
  const strip = tab.locator('[data-testid="status"]');
  const pdf = path.join(project.root, "build", "main.pdf");
  for (let n = 1; n <= 12; n += 1) {
    await tab.waitForTimeout(2500);
    const state = await strip.getAttribute("data-state").catch(() => "(gone)");
    const label = await strip.innerText().catch(() => "");
    const pane = (await tab.locator('[data-testid="preview-pane"]').innerText()
      .catch(() => "")).replace(/\n+/g, " ").slice(0, 90);
    console.log(
      `${(n * 2.5).toFixed(1)}s  strip=${state} "${label.replace(/\n/g, " ")}"  `
      + `pdf=${fs.existsSync(pdf) ? fs.statSync(pdf).size + "B" : "none"}  pane="${pane}"`,
    );
  }
  await tab.screenshot({ path: "/tmp/review-shots/a1-open-30s.png" });
});
