import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, ROOT, type Instance } from "../server";

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

test.beforeEach(() => {
  // Each test starts from nobody being signed in, so neither depends on
  // having run after the other.
  rmSync(join(sandbox, "signed-in"), { force: true });
});

test.afterAll(async () => {
  await app?.stop();
  rmSync(sandbox, { recursive: true, force: true });
});

test("a fresh install asks for a Claude account", async ({ page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.getByText("Connect your Claude account")).toBeVisible({
    timeout: 20_000,
  });
});

test("signing in shows the link, takes the code, and lets the writer in", async ({
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
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
