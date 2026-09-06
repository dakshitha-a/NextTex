import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject, startServer, ROOT, type Instance } from "../server";

/** The first screen a new user sees.
 *
 *  It waited for an `exit` event that nothing published, so after a
 *  *successful* sign-in the buttons never came back and the only way on was
 *  the "Continue without the agent" link -- which leaves the agent, the
 *  reason the app exists, switched off.  Nothing short of driving the whole
 *  screen would have caught it: both halves were individually correct.
 *
 *  The server here runs against `tests/fake_claude.py` instead of the real
 *  CLI, so this is the real pseudo-terminal, the real stream and the real
 *  screen -- with a program at the far end whose answers are known.
 */

let app: Instance;
let sandbox: string;

test.beforeAll(async () => {
  // Where the stand-in remembers that the sign-in happened.  Its own
  // directory, so one run never sees another run's answer.
  sandbox = mkdtempSync(join(tmpdir(), "nexttex-signin-"));
  app = await startServer({
    NEXTTEX_FAKE_CLAUDE_AUTH: "",          // unset: nobody is signed in yet
    NEXTTEX_CLAUDE_BINARY: join(ROOT, "tests", "fake_claude.py"),
    NEXTTEX_FAKE_CLAUDE_STATE: join(sandbox, "signed-in"),
  });
});

test.beforeEach(async () => {
  // Each test starts from nobody being signed in and no provider chosen.
  // Choosing one is a *persisted* setting, so without this the test that
  // picks "On my own" leaves the next one looking at the project list.
  rmSync(join(sandbox, "signed-in"), { force: true });
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": app.token,
    },
    body: JSON.stringify({ provider: "claude" }),
  });
});

test.afterAll(async () => {
  await app?.stop();
  rmSync(sandbox, { recursive: true, force: true });
});

test("a fresh install asks how you want to work, not who you are", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  // Three choices, and the third is a real one rather than a way out of a
  // nag screen: NextTex is a LaTeX editor before it is an AI tool.
  await expect(page.getByText("How would you like to work?")).toBeVisible({
    timeout: 20_000,
  });
  for (const option of ["With Claude", "With ChatGPT", "On my own"]) {
    await expect(page.getByRole("button", { name: new RegExp(option) })).toBeVisible();
  }
});

test("choosing to work alone gets straight to the projects", async ({ page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("button", { name: /On my own/ }).click();
  await expect(page.getByText(/project/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("How would you like to work?")).toHaveCount(0);
});

test("an OpenAI key is asked for as a key, not dressed up as a sign-in", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("button", { name: /With ChatGPT/ }).click();
  await expect(page.getByTestId("openai-key")).toBeVisible();
  // Said plainly, because somebody expecting to log in to ChatGPT needs to
  // know this bills an OpenAI account instead.
  await expect(page.getByText(/billed to your OpenAI account/)).toBeVisible();
  await expect(page.getByTestId("openai-key")).toHaveAttribute("type", "password");
});

test("signing in shows the link, takes the code, and lets the writer in", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("button", { name: /With Claude/ }).click();
  await page.getByRole("button", { name: "Sign in with a Claude account" }).click();

  // The verification URL is what a headless machine cannot show any other
  // way, so it has to arrive as a link the user can click.
  const link = page.getByRole("link", { name: /claude\.ai\/oauth/ });
  await expect(link).toBeVisible({ timeout: 20_000 });

  await page.getByPlaceholder("Paste the code here").fill("a-code-from-the-browser");
  await page.getByRole("button", { name: "Send" }).click();

  // ...and the screen gets out of the way of its own accord.
  await expect(page.getByText("Connect your Claude account")).toHaveCount(0, {
    timeout: 25_000,
  });
});

test("working alone leaves nothing on screen that needs an agent", async ({
  page,
}) => {
  const project = await seedProject(app, `alone-${Date.now()}`);
  // The whole promise of the third option: not a degraded app with dead
  // controls in it, but the same app with one column absent.
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false })
    .first().click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByText("What Claude reads")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show claude" })).toHaveCount(0);

  // And everything that is not about a model is still there.
  await expect(page.getByTestId("new-file")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /main\.tex/ }).first())
    .toBeVisible();
});

test("a writer who chose ChatGPT is never told they are talking to Claude", async ({
  page,
}) => {
  const project = await seedProject(app, `openai-${Date.now()}`);
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "openai", key: "sk-test-not-used" }),
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false })
    .first().click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // Every label in this column is the provider's name, including the menu
  // of models: offering an OpenAI writer `claude-opus-5` sends it to a
  // service that answers with a 404 about a model they never chose.
  const chat = page.getByTestId("chat");
  await expect(chat.getByText("ChatGPT").first()).toBeVisible();
  await expect(chat.getByText(/Claude/)).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask ChatGPT")).toBeVisible();
  await expect(page.getByText("What ChatGPT reads")).toBeVisible();
});
