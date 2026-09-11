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

    // Setting it aside leaves a line saying so, rather than a bare offer to
    // check: an update put off until a quieter afternoon has to leave
    // something on screen to come back to.
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByText("An update is waiting.")).toBeVisible();
    await expect(page.getByTestId("update-now")).toHaveCount(0);

    // And it survives a reload, because the check that runs when this screen
    // opens is the one a dismissal is about.
    await page.reload();
    await expect(page.getByText("An update is waiting.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("update-now")).toHaveCount(0);

    // Asking is different from being told. This is the half that was
    // missing, and the bug it now covers made the update unreachable: every
    // press was answered by the server and the answer thrown away by the
    // dismissal, so the button visibly did nothing for ever.
    await page.getByRole("button", { name: "Show it" }).click();
    await expect(page.getByTestId("update-headline")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("update-now")).toBeVisible();
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

test("a second install says which one it is", async ({ page }) => {
  buildRepo();
  const app = await startServer({
    NEXTTEX_INSTALL_ROOT: clone,
    NEXTTEX_INSTANCE: "dev",
  });
  try {
    await open(app, page);
    await expect(page.getByTestId("instance-badge")).toHaveText("dev");
    // The tab title too: that is where confusion actually happens.
    await expect(page).toHaveTitle(/dev/);
  } finally {
    await app.stop();
  }
});

test("the ordinary install carries no badge at all", async ({ page }) => {
  buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    await expect(page.getByTestId("instance-badge")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("a tab that joins a running update reloads when the server comes back", async ({
  page,
}) => {
  // Two things with no coverage until now: the case the design consult
  // named -- a second window, or this one reloaded, arriving with the job
  // already going -- and the reload itself, which is what the whole restart
  // dance exists to produce.
  //
  // The server is real; only its identity is stubbed, so the page sees
  // exactly what it would see if a different process had answered.
  buildRepo();
  commitUpstream("server/main.py", "a real change");
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await page.addInitScript(() => {
      const real = window.fetch;
      const started = Date.now();
      // sessionStorage, not a window property: `window` is a fresh
      // object after a reload, so a counter on it can never exceed one.
      sessionStorage.setItem(
        "loads",
        String(Number(sessionStorage.getItem("loads") ?? "0") + 1),
      );
      window.fetch = async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes("/api/instance")) {
          // A different process answers after two seconds.
          const boot = Date.now() - started > 2000 ? "after" : "before";
          return new Response(JSON.stringify({ instance: "", head: "x", boot,
                                               supervised: true, root: "/tmp" }),
                              { status: 200,
                                headers: { "content-type": "application/json" } });
        }
        const response = await real(input, init);
        if (url.includes("/api/update") && !url.includes("stream")) {
          const body = await response.clone().json();
          return new Response(JSON.stringify({ ...body, updating: true }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        return response;
      };
    });
    await open(app, page);

    // It joins the job rather than offering to start another one.
    await expect(page.getByText("Updating NextTex")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("update-now")).toHaveCount(0);

    // And when a different process answers, the page reloads itself.  The
    // counter is in sessionStorage, which a reload does not clear.
    await expect
      .poll(() => page.evaluate(() => Number(sessionStorage.getItem("loads"))), {
        timeout: 20_000,
      })
      .toBeGreaterThan(1);
    await expect(page.getByText(/Stop it and start it again/)).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
