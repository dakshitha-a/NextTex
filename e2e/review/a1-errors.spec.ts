import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The error pane, driven by writing real broken LaTeX into the file rather
 *  than by typing past `\end{document}`, where the engine ignores it. */

async function put(page: Page, base: string, token: string, id: string, text: string) {
  await page.evaluate(
    async ({ base, token, id, text }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({ path: "main.tex", text }),
      });
    },
    { base, token, id, text },
  );
}

const GOOD = `\\documentclass{article}
\\begin{document}
\\section{One}
\\label{sec:one}
Ordinary prose.
\\end{document}
`;

test("an undefined command, and whether fixing it clears the pane", async ({
  app, project, tab,
}) => {
  const strip = tab.locator('[data-testid="status"]');
  await put(tab, app.base, app.token, project.id, GOOD);
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 60_000 }).toBe("built");
  console.log("CLEAN:", await strip.innerText());

  await put(tab, app.base, app.token, project.id,
    GOOD.replace("Ordinary prose.", "Ordinary \\notARealCommand{x} prose."));
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 60_000 }).toBe("errors");
  console.log("BROKEN:", await strip.innerText());
  await strip.click();
  await tab.waitForTimeout(800);
  const drawer = await tab.locator('[data-testid="diagnostics"]').innerText();
  console.log("DRAWER:", drawer.replace(/\n+/g, " | ").slice(0, 400));
  await tab.screenshot({ path: "/tmp/review-shots/a1-errors-drawer.png" });

  // Does an explanation exist, and does expanding a row show it?
  const row = tab.locator('[data-testid="diagnostics"] [role="button"]').first();
  await row.click();
  await tab.waitForTimeout(500);
  console.log("EXPANDED:", (await tab.locator('[data-testid="diagnostics"]').innerText())
    .replace(/\n+/g, " | ").slice(0, 500));
  await tab.screenshot({ path: "/tmp/review-shots/a1-errors-expanded.png" });

  // Fix it: does the drawer empty?
  await put(tab, app.base, app.token, project.id, GOOD);
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 60_000 }).toBe("built");
  await tab.waitForTimeout(1200);
  console.log("AFTER FIX strip:", await strip.innerText());
  console.log("AFTER FIX drawer:",
    (await tab.locator('[data-testid="diagnostics"]').innerText().catch(() => "(gone)"))
      .replace(/\n+/g, " | ").slice(0, 300));
});

test("which error is named as the one to start from", async ({
  app, project, tab,
}) => {
  // A missing package in the preamble is the cause; the undefined command in
  // the chapter is its consequence.  main.tex sorts after chapters/.
  await tab.evaluate(
    async ({ base, token, id }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({
          path: "chapters/one.tex",
          text: "\\section{One}\nA \\notARealCommand{x} here.\n",
        }),
      });
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({
          path: "main.tex",
          text: "\\documentclass{article}\n\\usepackage{thispackagedoesnotexist}\n"
            + "\\begin{document}\n\\include{chapters/one}\n\\end{document}\n",
        }),
      });
    },
    { base: app.base, token: app.token, id: project.id },
  );
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  const strip = tab.locator('[data-testid="status"]');
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 90_000 }).not.toBe("compiling");
  await strip.click().catch(() => undefined);
  await tab.waitForTimeout(1500);
  const body = await tab.locator("body").innerText();
  console.log("STRIP:", await strip.innerText());
  const drawer = await tab.locator('[data-testid="diagnostics"]').innerText()
    .catch(() => "(no drawer)");
  console.log("DRAWER:", drawer.replace(/\n+/g, " | ").slice(0, 600));
  await tab.screenshot({ path: "/tmp/review-shots/a1-which-error.png" });
});
