import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server";

/** Report a problem, at the foot of the project list.
 *
 *  The server is pointed at a repository this test built, whose origin is a
 *  local path, so the issue link exercises the fallback to the canonical
 *  repository; and every request to github.com is aborted at the browser,
 *  so nothing here can leave the machine even by accident.
 */

function git(root: string, ...args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

let sandbox: string;

function buildRepo(): string {
  sandbox = mkdtempSync(join(tmpdir(), "nexttex-report-"));
  const remote = join(sandbox, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare", "--initial-branch=main");
  const work = join(sandbox, "work");
  mkdirSync(work);
  git(work, "init", "--initial-branch=main");
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "T");
  writeFileSync(join(work, "README.md"), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "-m", "first");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-u", "origin", "main");
  const clone = join(sandbox, "clone");
  git(sandbox, "clone", remote, clone);
  return clone;
}

test.afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

test("the report is redacted, quotes what the page saw, and points at the form", async ({ page, context }) => {
  const clone = buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("https://github.com/**", (route) => route.abort());

    // A log the server would have written on macOS or Windows, holding the
    // one thing that must not come out.
    const state = join(app.sandbox, "data", "nexttex");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "server.log"), `http://127.0.0.1:1/?token=${app.token}\nfine\n`);

    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByRole("heading", { name: "NextTex" }).waitFor({ timeout: 20_000 });

    // Something the interface saw go wrong, outside React's tree.
    await page.evaluate(() => {
      window.setTimeout(() => {
        throw new Error("planted interface error");
      }, 0);
    });
    await page.waitForTimeout(50);

    await page.getByTestId("report-problem").click();
    const card = page.getByTestId("report-card");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("The report is on your clipboard.")).toBeVisible();

    await card.getByText("Show the report").click();
    const text = await page.getByTestId("report-text").innerText();
    expect(text).toMatch(/^NextTex report/);
    expect(text).toContain("planted interface error");
    expect(text).toContain("?token=[redacted]");
    expect(text).not.toContain(app.token);

    const href = await page.getByTestId("report-open").getAttribute("href");
    expect(href).toMatch(/^https:\/\/github\.com\/dakshitha-a\/NextTex\/issues\/new\?template=bug\.yml/);
    expect(href).toContain("where=");
    expect(href).toContain("commit=");
    expect(href).not.toContain("labels=");

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(text);

    await page.screenshot({ path: "shots/out-report.png",
      clip: { x: 0, y: 0, width: 1280, height: 720 } });

    await card.getByText("Close").click();
    await expect(card).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("a 500 from the server is remembered and quoted", async ({ page }) => {
  const clone = buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByRole("heading", { name: "NextTex" }).waitFor({ timeout: 20_000 });
    // Answered by the browser rather than the server, so the test does not
    // have to break the server to see the record of a broken server.
    await page.route("**/api/update?force=true", (route) =>
      route.fulfill({ status: 500, contentType: "application/json",
        body: JSON.stringify({ error: "Something went wrong inside NextTex. The server's log has the details, under deadbeef." }) }));
    await page.getByRole("button", { name: /Check again|Check for updates|Try again/ }).first().click();
    await page.getByTestId("report-problem").click();
    await page.getByTestId("report-card").waitFor({ timeout: 15_000 });
    await page.getByText("Show the report").click();
    const text = await page.getByTestId("report-text").innerText();
    expect(text).toMatch(/api\s+500 \/update\?force=true: .*deadbeef/);
  } finally {
    await app.stop();
  }
});
