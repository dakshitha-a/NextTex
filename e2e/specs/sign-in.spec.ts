import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject, startServer, ROOT, type Instance } from "../server";

/** The first thing a new install asks: what writes with you.
 *
 *  It is a sheet over the projects list rather than a screen of its own,
 *  with the three choices as rows and each one's setup inside its row.
 *  The Claude row drives `claude auth login` under a pseudo-terminal on
 *  the server and streams what it prints; it once waited for an `exit`
 *  event that nothing published, so after a *successful* sign-in the
 *  buttons never came back.  Nothing short of driving the whole sheet
 *  would have caught it: both halves were individually correct.
 *
 *  The server here runs against `tests/fake_claude.py` instead of the real
 *  CLI, so this is the real pseudo-terminal, the real stream and the real
 *  sheet, with a program at the far end whose answers are known.
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
  // picks "No agent" leaves the next one looking at a closed sheet.
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

const sheetOf = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "What writes with you" });

test("a fresh install asks what writes with you, over its list, and cannot be left unanswered", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  // Over the projects screen, not instead of it.
  await expect(page.getByText("Projects", { exact: true })).toBeVisible();
  // Three choices as rows, and the third is a real one rather than a way
  // out of a nag screen: NextTex is a LaTeX editor before it is an AI tool.
  const rows = sheet.getByRole("radio");
  await expect(rows).toHaveText([
    /^Claude/, /^ChatGPT, or a model on this machine/, /^No agent/,
  ]);
  // Claude is the row that opens, since it is the install's default, and
  // its setup sits inside it.
  await expect(sheet.getByTestId("agent-claude")).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByTestId("claude-sign-in")).toBeVisible();
  // Nothing writes with you yet, so there is no Cancel and Escape does
  // nothing; "No agent" is one press away.
  await expect(sheet.getByTestId("agent-cancel")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  // And the bar's control says the same thing.
  await expect(page.getByTestId("set-up-agent")).toHaveText(/Not set up/);
});

test("choosing to work alone closes the sheet and leaves the list", async ({ page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await sheet.getByTestId("agent-none").click({ timeout: 20_000 });
  await expect(sheet.getByTestId("agent-confirm")).toHaveText("Use no agent");
  await sheet.getByTestId("agent-confirm").click();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("Projects", { exact: true })).toBeVisible();
  await expect(page.getByTestId("set-up-agent")).toHaveText(/No agent/);
});

test("a refusal on one row does not follow the writer into another", async ({
  page,
}) => {
  // A refused route stands in for the failure, since the real one needs a
  // server that cannot write its config.
  await page.route("**/api/agent/provider", (route) =>
    route.fulfill({ status: 500, contentType: "application/json",
                    body: JSON.stringify({ detail: "the config could not be written" }) }),
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await sheet.getByTestId("agent-none").click({ timeout: 20_000 });
  await sheet.getByTestId("agent-confirm").click();
  await expect(sheet.getByText(/could not be written/)).toBeVisible();
  await sheet.getByTestId("agent-openai").click();
  await expect(sheet.getByTestId("openai-key")).toBeVisible();
  await expect(sheet.getByText(/could not be written/)).toHaveCount(0);
});

test("an OpenAI key is asked for as a key, not dressed up as a sign-in", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await sheet.getByTestId("agent-openai").click({ timeout: 20_000 });
  await expect(sheet.getByTestId("openai-key")).toBeVisible();
  // Said plainly, because somebody expecting to log in to ChatGPT needs to
  // know this bills an OpenAI account instead.
  await expect(sheet.getByText(/billed to your OpenAI account/)).toBeVisible();
  await expect(sheet.getByTestId("openai-key")).toHaveAttribute("type", "password");
  // The setup is the row's, not the radio's: no control sits inside another.
  await expect(sheet.getByRole("radio", { name: /ChatGPT/ }).locator("input")).toHaveCount(0);
});

test("a local server is the OpenAI choice with a base URL and no key", async ({
  page,
}) => {
  /* Ollama, LM Studio and vLLM speak OpenAI's protocol, so a base URL is
     nearly the whole of running a model on this machine.  Nothing here
     reaches a model: the sheet saves the settings and the status says
     ready, which is as far as a browser test can go without one. */
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await sheet.getByTestId("agent-openai").click({ timeout: 20_000 });
  await expect(sheet.getByText(/localhost:11434/)).toBeVisible();
  await sheet.getByTestId("openai-base-url").fill("http://localhost:11434/v1");
  // A local server has no default model, so the sheet says so before it
  // saves rather than letting the first turn fail.
  await expect(sheet.getByTestId("agent-confirm")).toHaveText("Use ChatGPT");
  await sheet.getByTestId("agent-confirm").click();
  await expect(sheet.getByText(/needs the model named/)).toBeVisible();
  await sheet.getByTestId("openai-model").fill("llama3.1");
  await sheet.getByTestId("agent-confirm").click();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });

  const status = await fetch(`${app.base}/api/agent/status`, {
    headers: { "x-nexttex-token": app.token },
  }).then((r) => r.json());
  expect(status).toMatchObject({
    provider: "openai", ready: true, model: "llama3.1", keyTail: "",
    baseUrl: "http://localhost:11434/v1",
  });
  await expect(page.getByTestId("set-up-agent")).toHaveText(/ChatGPT/);
  // Back to no agent for the specs that follow, and the URL goes with
  // the key.
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  });
});

test("signing in shows the link, takes the code, and lets the writer in", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const sheet = sheetOf(page);
  await sheet.getByTestId("claude-sign-in").click({ timeout: 20_000 });

  // The verification URL is what a headless machine cannot show any other
  // way, so it has to arrive as a link the user can click.
  const link = sheet.getByRole("link", { name: /claude\.ai\/oauth/ });
  await expect(link).toBeVisible({ timeout: 20_000 });

  await sheet.getByPlaceholder("Paste the code here").fill("a-code-from-the-browser");
  await sheet.getByRole("button", { name: "Send" }).click();

  // ...and the sheet gets out of the way of its own accord.
  await expect(sheet).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByTestId("set-up-agent")).toHaveText(/Claude/);
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
  await expect(sheetOf(page)).toHaveCount(0);
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

test("a machine with no Claude CLI is offered one rather than a download page", async ({
  page,
}) => {
  // Somebody who chose "no agent" during the install and has changed their
  // mind. Until now this screen told them to go and fetch the CLI
  // themselves, which is a dead end on the first screen of a new install,
  // while the terminal installer three feet away would have done it.
  //
  // Its own server, because whether the CLI is here is read from
  // NEXTTEX_CLAUDE_BINARY, and every other test in this file wants one that
  // is. The install itself is never started: nothing here fetches a vendor
  // script, and the button being offered is the thing under test.
  const other = await startServer({
    NEXTTEX_FAKE_CLAUDE_AUTH: "",
    NEXTTEX_CLAUDE_BINARY: join(tmpdir(), "nexttex-no-claude-here"),
  });
  try {
    await fetch(`${other.base}/api/agent/provider`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nexttex-token": other.token,
      },
      body: JSON.stringify({ provider: "claude" }),
    });
    await page.goto(`${other.base}/?token=${other.token}`);
    const sheet = sheetOf(page);
    await expect(sheet.getByTestId("install-claude")).toBeVisible({
      timeout: 20_000,
    });
    await expect(sheet.getByText(/not on this machine yet/)).toBeVisible();
    // And it does not offer to sign in to something that is not there.
    await expect(sheet.getByTestId("claude-sign-in")).toHaveCount(0);
    // The other rows are still there: the way past this is never closed.
    await expect(sheet.getByTestId("agent-none")).toBeVisible();
  } finally {
    await other.stop();
  }
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
  await page.getByTestId("context-open").click();
  await expect(page.getByRole("heading", { name: "What ChatGPT reads" })).toBeVisible();
});
