import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, openFolders, openProject } from "../fixtures";

/** Python scripts in the source pane.
 *
 *  The agent draws a figure by writing a script into `scripts/` and running
 *  it, and the README promised the writer could open that script and change
 *  it.  These specs are about the script being a file the editor treats as
 *  its own: it opens, it reads as Python, and the spell checker leaves it
 *  alone.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  const first = body.split("\n")[0];
  await expect(page.locator(".cm-content")).toContainText(first, { timeout: 15_000 });
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

/** Running a script, and reading what it did in the preview pane.
 *
 *  The pane shows a script tab beside the documents: what the run printed,
 *  what it drew, what it wrote, and on a failure the traceback and the two
 *  ways forward.  One run at a time per script; the run is announced to
 *  every window; the tab is this window's own.
 */

test("Run shows what the script printed on a script tab in the preview pane", async ({
  app, project, page,
}) => {
  await withScript({ app, project, page });
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("script-tab-scripts/hello.py")).toBeVisible();
  await expect(page.getByTestId("script-tab-scripts/hello.py")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("script-stdout")).toContainText("hello world", { timeout: 20_000 });
  await expect(page.getByTestId("script-outcome")).toHaveText(/Ran in/);
  // The page comes back when a chapter comes to the front, and the script
  // tab stays where it is.
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("script-tab-scripts/hello.py")).toBeVisible();
  await expect(page.getByTestId("script-pane")).toHaveCount(0);
  // Clicking the script tab brings the run back; closing it returns to the page.
  await page.getByTestId("script-tab-scripts/hello.py").click();
  await expect(page.getByTestId("script-stdout")).toContainText("hello world");
  // The source tab has a close button of the same name; the strip's is
  // the one the test means.
  await page.getByTestId("preview-strip").getByRole("button", { name: "Close hello.py" }).click();
  await expect(page.getByTestId("script-tab-scripts/hello.py")).toHaveCount(0);
  await expect(page.getByTestId("script-pane")).toHaveCount(0);
});

test("Ctrl-Enter in a script runs it", async ({ app, project, page }) => {
  await withScript({ app, project, page });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("script-stdout")).toContainText("hello world", { timeout: 20_000 });
});

test("a failing run shows the traceback and hands it to the agent on one press", async ({
  app, project, page,
}) => {
  await withScript({ app, project, page }, "x = 1\nraise ValueError('the axis is wrong')\n");
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("script-outcome")).toHaveText("Exit 1", { timeout: 20_000 });
  await expect(page.getByTestId("script-stderr")).toContainText("ValueError: the axis is wrong");
  await expect(page.getByTestId("script-stderr")).toContainText("line 2");
  // The composer is seeded, never sent: the writer presses Enter on their
  // own message.
  await page.getByTestId("script-ask-agent").click();
  const composer = page.locator("textarea");
  await expect(composer).toHaveValue(/^Fix scripts\/hello\.py\. I ran it from the editor and it failed with exit 1:/);
  await expect(composer).toHaveValue(/ValueError: the axis is wrong/);
  await expect(composer).toHaveValue(/When it runs, say what you changed\.$/);
});

test("a missing package is offered as an install, and only after a second press", async ({
  app, project, page,
}) => {
  await withScript({ app, project, page }, "import seaborn_definitely_absent\n");
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("script-outcome")).toHaveText("Exit 1", { timeout: 20_000 });
  const install = page.getByTestId("script-install");
  await expect(install).toHaveText("Install seaborn_definitely_absent");
  await install.click();
  // The first press says what it reaches and asks again; nothing has been
  // fetched yet.
  await expect(install).toHaveText("Yes, install seaborn_definitely_absent");
  await expect(page.getByTestId("script-actions")).toContainText("PyPI");
});

test("with no agent, the failure has no agent to go to", async ({ app, project, page }) => {
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  });
  await withScript({ app, project, page }, "raise SystemExit(2)\n");
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("script-outcome")).toHaveText("Exit 2", { timeout: 20_000 });
  await expect(page.getByTestId("script-ask-agent")).toHaveCount(0);
});

test("a run can be stopped from the header", async ({ app, project, page }) => {
  await withScript({ app, project, page }, "import time\nprint('started', flush=True)\ntime.sleep(60)\n");
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("stop-script")).toBeVisible();
  await expect(page.getByTestId("script-outcome")).toHaveText("Running");
  await page.getByTestId("stop-script").click();
  await expect(page.getByTestId("script-outcome")).toHaveText("Stopped", { timeout: 10_000 });
  await expect(page.getByTestId("run-script")).toBeVisible();
});

test("Run from the tree's row menu opens the script and runs it", async ({
  app, project, page,
}) => {
  mkdirSync(join(project.root, "scripts"), { recursive: true });
  writeFileSync(join(project.root, "scripts", "hello.py"), HELLO);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await openFolders(page, "scripts/hello.py");
  await page.getByLabel("Actions for hello.py").click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("def greet", { timeout: 15_000 });
  await expect(page.getByTestId("script-stdout")).toContainText("hello world", { timeout: 20_000 });
});

test("what a script draws is in the pane", async ({ app, project, page }) => {
  // Needs matplotlib in the server's own interpreter, which the installer
  // provides and a bare checkout may not.  Asked of that interpreter
  // directly, and skipped with a reason rather than failing for the
  // absence of a library the test did not install.
  const probe = spawnSync(
    join(ROOT, ".venv", "bin", "python"), ["-c", "import matplotlib"], { stdio: "ignore" },
  );
  test.skip(probe.status !== 0, "matplotlib is not installed in the server's interpreter");
  await withScript(
    { app, project, page },
    "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()\nprint('shown')\n",
  );
  await page.getByTestId("run-script").click();
  await expect(page.getByTestId("script-stdout")).toContainText("shown", { timeout: 60_000 });
  const figure = page.getByTestId("script-figure").first();
  await expect(figure).toBeVisible();
  await expect.poll(async () => figure.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
});
