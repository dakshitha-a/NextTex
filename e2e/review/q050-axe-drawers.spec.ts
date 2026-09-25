import { test } from "../fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Every drawer on the rail, through axe, in both themes.
 *
 *  The probe of September 2026 found `a-axe-sweep.spec.ts` skipping five of
 *  its eight surfaces, because the controls it clicked were renamed in the
 *  visual overhaul, and passing anyway.  This one opens each drawer by the
 *  bar's own test ids, and puts a comment thread in the Comments drawer
 *  first, since Q-050 is about its rows and an empty drawer has none.
 *  Prints violations of serious or critical impact; asserts nothing. */

const DRAWERS = ["files", "sections", "search", "papers", "history", "git",
  "people", "comments", "build", "submit", "download", "trash"];
const ALLOWED = ["scrollable-region-focusable"];

async function sweep(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = results.violations.filter(
    (v) => !ALLOWED.includes(v.id) && ["serious", "critical"].includes(v.impact ?? ""));
  if (!bad.length) { console.log(`OK   ${where}`); return; }
  for (const v of bad) {
    console.log(`AXE  ${where}: ${v.id} (${v.impact}) ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`       ${n.target.join(" ")}`);
  }
}

for (const theme of ["light", "dark"]) {
  test(`every drawer, ${theme}`, async ({ tab }) => {
    await tab.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
    await tab.reload();
    await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
    await tab.emulateMedia({ reducedMotion: "reduce" });

    // One thread, made the way a writer makes one.
    await tab.locator(".cm-content").click();
    await tab.keyboard.press("Control+End");
    await tab.keyboard.press("Enter");
    await tab.keyboard.type("The fast component is 180 fs in hexane.");
    await tab.keyboard.press("ArrowLeft");
    for (let i = 0; i < 6; i += 1) await tab.keyboard.press("Shift+ArrowLeft");
    await tab.getByTestId("selection-comment").click();
    await tab.getByRole("textbox", { name: "Comment" }).fill("Which solvent is the slow one?");
    await tab.keyboard.press("Control+Enter");
    await tab.locator(".cm-content .nx-comment").last().waitFor();
    await tab.keyboard.press("Escape");

    for (const id of DRAWERS) {
      const button = tab.getByTestId(`bar-${id}`);
      if (!(await button.count())) { console.log(`SKIP ${id} ${theme}: no bar-${id}`); continue; }
      const drawer = tab.getByTestId("drawer");
      const showing = (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === id;
      if (!showing) await button.click();
      await tab.waitForTimeout(600);
      if (id === "comments") {
        const rows = await tab.getByTestId("comment-row").count();
        console.log(`     comments ${theme}: ${rows} row(s) in the drawer`);
      }
      await sweep(tab, `${id} ${theme}`);
    }
  });
}
