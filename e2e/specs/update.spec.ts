import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type Instance } from "../server";

/** The update affordance on the project list.
 *
 *  The server is pointed at a repository this test built, with a remote it
 *  controls, so nothing here touches the network or depends on what the
 *  real repository happens to hold today.
 */

function git(root: string, ...args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

let sandbox: string;
let work: string;
let clone: string;

function buildRepo() {
  sandbox = mkdtempSync(join(tmpdir(), "nexttex-update-"));
  const remote = join(sandbox, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare", "--initial-branch=main");

  work = join(sandbox, "work");
  mkdirSync(work);
  git(work, "init", "--initial-branch=main");
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "T");
  writeFileSync(join(work, "README.md"), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "-m", "first");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-u", "origin", "main");

  clone = join(sandbox, "clone");
  git(sandbox, "clone", remote, clone);
}

function commitUpstream(path: string, message: string) {
  const full = join(work, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "x\n");
  git(work, "add", "-A");
  git(work, "commit", "-m", message);
  git(work, "push");
}

test.afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

async function open(app: Instance, page: import("@playwright/test").Page) {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("heading", { name: "NextTex" }).waitFor({ timeout: 20_000 });
}

test("an install level with its repository says so quietly", async ({ page }) => {
  buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    await expect(page.getByText("Up to date.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("update-now")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("commits that change nothing are mentioned, not pressed", async ({ page }) => {
  buildRepo();
  commitUpstream("docs/one.md", "a documentation change");
  commitUpstream("README.md", "another one");
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    // The whole rule: this is the first screen of every session, and two
    // README edits must not arrive as an alert.
    await expect(
      page.getByText("2 new commits, none of which change NextTex."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("update-headline")).toHaveCount(0);

    await page.getByRole("button", { name: "Show them" }).click();
    await expect(page.getByText("a documentation change")).toBeVisible();
    await expect(page.getByText("docs").first()).toBeVisible();
  } finally {
    await app.stop();
  }
});

test("a commit that reaches the program is offered properly", async ({ page }) => {
  buildRepo();
  commitUpstream("docs/one.md", "a documentation change");
  commitUpstream("server/main.py", "a real change");
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    await expect(page.getByTestId("update-headline")).toHaveText(
      "Two new commits, one of which changes NextTex.",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("update-now")).toBeVisible();
    await expect(page.getByText("a real change")).toBeVisible();
    // Written into the gitignored shots directory, for looking at.
    await page.screenshot({ path: "shots/out-update.png",
                            clip: { x: 440, y: 300, width: 800, height: 420 } });

    // Dismissing it leaves the resting line, and does not come back.
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("update-now")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("uncommitted work in the install is refused with its reason", async ({ page }) => {
  buildRepo();
  commitUpstream("server/main.py", "a real change");
  writeFileSync(join(clone, "scratch.txt"), "mine\n");
  git(clone, "add", "-A");
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    await expect(
      page.getByText("The NextTex folder has changes that are not committed."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("scratch.txt")).toBeVisible();
    // No button that would be refused if pressed.
    await expect(page.getByTestId("update-now")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("an install that is not a checkout says nothing at all", async ({ page }) => {
  const plain = mkdtempSync(join(tmpdir(), "nexttex-plain-"));
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: plain });
  try {
    await open(app, page);
    await expect(page.getByRole("button", { name: "Check for updates" })).toHaveCount(0);
    await expect(page.getByText(/new commit/)).toHaveCount(0);
  } finally {
    await app.stop();
    rmSync(plain, { recursive: true, force: true });
  }
});
