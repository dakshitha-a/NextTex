import { test } from "../fixtures";

/** The preview after a build that fails, on the article template, in a
 *  browser.  The probe's writer journey saw "Nothing has been typeset yet"
 *  with three errors on the strip and two pages a moment before; the
 *  server-side driver beside this one finds the PDF route answering 200
 *  after a failed build, so this watches the pane itself. */
test("the preview after a failed build, on the article template", async ({ app, page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByPlaceholder(/Where to put it/).fill(`${app.projects}/solvent-paper`);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.locator(".nx-page").first().waitFor({ timeout: 60_000 });
  const say = async (label: string) => {
    const empty = await page.getByText("Nothing has been typeset yet.").isVisible();
    const pages = await page.locator(".nx-page").count();
    const status = await page.getByTestId("status").innerText().catch(() => "");
    const id = await page.evaluate(() => location.pathname + location.hash);
    console.log(`${label}: pages=${pages} empty-message=${empty} strip="${status.replace(/\s+/g, " ").slice(0, 60)}" at ${id}`);
  };
  await say("CLEAN");
  // The writer journey's steps two to seven, as it typed them.
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.type("\\section{Solvent effects}\\label{sec:solvent}\nThe decay is fastest in water, as Section~\\ref{sec:");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(" shows.\n\n");
  await page.keyboard.type("\\begin{itemize}\n\\item one\n");
  await page.getByTestId("status").getByText(/error/i).waitFor({ timeout: 30_000 });
  await say("WITH THE ERROR");
  await page.keyboard.press("F8");
  await page.waitForTimeout(500);
  await page.keyboard.type("\\end{itemize}\n");
  await page.waitForTimeout(4000);
  await say("AFTER THE FIX AT F8");
  const text = await page.evaluate(async ({ base, token }) => {
    const projects = await (await fetch(`${base}/api/projects`, { headers: { "x-nexttex-token": token } })).json();
    const list = projects.projects ?? projects;
    const id = list.find((p: { path: string }) => p.path.endsWith("solvent-paper")).id;
    const file = await (await fetch(`${base}/api/projects/${id}/file?path=main.tex`, { headers: { "x-nexttex-token": token } })).json();
    const pdf = await fetch(`${base}/api/projects/${id}/pdf`, { headers: { "x-nexttex-token": token } });
    const log = await fetch(`${base}/api/projects/${id}/log`, { headers: { "x-nexttex-token": token } });
    const logText = log.ok ? await log.text() : String(log.status);
    return { tail: file.text.split("\n").slice(-12).join("\n"), pdf: pdf.status, log: logText.split("\n").filter((l: string) => l.startsWith("!") || /Fatal|Emergency|no output/.test(l)).slice(0, 8).join("\n") };
  }, { base: app.base, token: app.token });
  console.log("THE FILE ENDS:\n" + text.tail);
  console.log("PDF ROUTE:", text.pdf);
  console.log("THE LOG SAYS:\n" + text.log);
});
