import { test, expect } from "../fixtures";

/** Two recoverable errors, in two files, where alphabetical order and
 *  document order disagree.  The first attempt used a missing package, which
 *  aborts the run before the chapter is ever read, so only one file had
 *  errors and the sort could not be seen. */
test("the one to start from, with both errors recoverable", async ({
  app, project, tab,
}) => {
  await tab.evaluate(
    async ({ base, token, id }) => {
      const put = (path: string, text: string) =>
        fetch(`${base}/api/projects/${id}/file`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-nexttex-token": token },
          body: JSON.stringify({ path, text, create: true }),
        });
      await put("chapters/one.tex", "\\section{One}\nLater: \\bbbLaterProblem{x}\n");
      await put("main.tex",
        "\\documentclass{article}\n\\begin{document}\n"
        + "Earlier: \\aaaEarlierProblem{x}\n"
        + "\\include{chapters/one}\n\\end{document}\n");
    },
    { base: app.base, token: app.token, id: project.id },
  );
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  const strip = tab.locator('[data-testid="status"]');
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 90_000 }).toBe("errors");
  await strip.click();
  await tab.waitForTimeout(1200);
  console.log("SUMMARY:", (await tab.locator('[data-testid="build-summary"]').innerText()
    .catch(() => "(none)")).replace(/\n+/g, " | "));
  console.log("DRAWER:", (await tab.locator('[data-testid="diagnostics"]').innerText())
    .replace(/\n+/g, " | ").slice(0, 400));
  console.log("Document order says the error in main.tex comes first.");
  await tab.screenshot({ path: "/tmp/review-shots/a1-which-error.png" });
});
