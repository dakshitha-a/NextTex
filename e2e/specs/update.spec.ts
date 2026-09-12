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
    // Into the gitignored shots directory, beside the card above it, so the
    // two states this screen has can be looked at together.
    await page.screenshot({ path: "shots/out-update-waiting.png",
                            clip: { x: 440, y: 648, width: 800, height: 44 } });

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
      // sessionStorage, not a window property: `window` is a fresh
      // object after a reload, so a counter on it can never exceed one.
      sessionStorage.setItem(
        "loads",
        String(Number(sessionStorage.getItem("loads") ?? "0") + 1),
      );
      // And the clock the stub answers from goes in there too, for exactly
      // the same reason.  This script re-runs on every navigation, so a
      // `Date.now()` local to it restarted on the reloaded page: the second
      // page was told "before" for two seconds all over again, reloaded
      // itself, and so on for ever.  The assertion below usually caught the
      // counter at two and passed, but a `page.evaluate` that landed on one
      // of those reloads died with "Execution context was destroyed" --
      // which is the flake this test has been carrying rather than anything
      // about the page.  Kept across the reload, the second page is told
      // "after" from its first tick, adopts it as the process it is watching
      // and stays put, so there is exactly one reload and nothing to race.
      const started = Number(sessionStorage.getItem("clock") ?? "0") || Date.now();
      sessionStorage.setItem("clock", String(started));
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

test("an install updated on disk and not restarted says so", async ({ page }) => {
  // R-041. The instance route answered `head` by running `git rev-parse
  // HEAD` when it was asked, which reads the working tree. That is the code
  // on disk; the question is what the running process loaded. An update
  // moves the first and leaves the second, so a laptop was found serving
  // day-old code with three places on screen agreeing it was current: the
  // instance banner, the commit under it, and the footer, all reporting the
  // same disk commit and comparing it against a remote it matched.
  buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    await expect(page.getByTestId("update-unrestarted")).toHaveCount(0);

    // Exactly what an update does: the files move, this process does not.
    commitUpstream("server/main.py", "a real change");
    git(clone, "pull", "--ff-only");

    await page.reload();
    await expect(page.getByTestId("update-unrestarted")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Up to date.")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("the restart line offers a restart, not a reload", async ({ page }) => {
  // A Windows laptop pulled to a new commit without restarting, read the
  // line, and pressed the only control on it. Nothing happened: Reload
  // fetches the page from the same process, `head` is read once when that
  // process starts, and the sentence that came back was byte for byte the
  // one they had just read. The control is the restart the sentence asks
  // for now, and it is only there when something will bring NextTex back.
  buildRepo();
  const app = await startServer({
    NEXTTEX_INSTALL_ROOT: clone,
    INVOCATION_ID: "pretend-systemd-started-this",
  });
  try {
    await open(app, page);
    commitUpstream("server/main.py", "a real change");
    git(clone, "pull", "--ff-only");
    await page.reload();
    await expect(page.getByTestId("update-unrestarted")).toBeVisible({
      timeout: 20_000,
    });

    // Answered here rather than let through, because the real route ends
    // in os._exit and the server under this test has no supervisor to
    // bring it back. What the exit does is covered in tests/api.
    let asked = 0;
    await page.route("**/api/update/restart", (route) => {
      asked += 1;
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ restarting: true }),
      });
    });

    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restart now" }).click();
    await expect(page.getByText("Restarting")).toBeVisible();
    expect(asked).toBe(1);
  } finally {
    await app.stop();
  }
});

test("with no supervisor the line asks for the restart in words", async ({ page }) => {
  // The same state on an install nothing would start again. There is no
  // control, because there is nothing the page could press that would
  // work, and the sentence says what to do instead.
  buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await open(app, page);
    commitUpstream("server/main.py", "a real change");
    git(clone, "pull", "--ff-only");
    await page.reload();
    const line = page.getByTestId("update-unrestarted");
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line).toContainText("Stop NextTex and start it again");
    await expect(page.getByRole("button", { name: "Restart now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("a long reason from git does not carry Try again off the footer", async ({
  page,
}) => {
  // The unreachable-repository line puts git's own words next to the
  // control, and git's own words can be a paragraph. They wrapped to three
  // rows and pushed Try again down and out of the strip.
  buildRepo();
  const app = await startServer({ NEXTTEX_INSTALL_ROOT: clone });
  try {
    await page.route("**/api/update*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          checkout: true,
          checked: false,
          head: "abc1234",
          behind: 0,
          changing: 0,
          commits: [],
          dirty: [],
          rebuild: false,
          build_ok: true,
          build_reason: "",
          can_update: false,
          reason: "could not reach the repository",
          restart: "manual",
          error:
            "fatal: unable to access 'https://github.com/dakshitha-a/NextTex/': " +
            "Could not resolve host: github.com, and the proxy this machine is " +
            "behind did not answer either, so nothing was read, and nothing " +
            "below this line was read off a fetch that happened; the numbers " +
            "you can see are the defaults this report carries when it cannot " +
            "reach anything at all",
          updating: false,
          phase: "",
        }),
      }),
    );
    await open(app, page);
    const warn = page.getByTestId("update-unchecked");
    await expect(warn).toBeVisible({ timeout: 20_000 });
    // The row itself, not the pieces on it: `items-center` keeps a button
    // centred in a line three rows tall, so comparing the two boxes' tops
    // would call a wrapped line straight.
    const row = warn.locator("..");
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(24);
    // And the message is still readable in full, on hover.
    await expect(warn.locator("..").locator("span[title]")).toHaveAttribute(
      "title",
      /Could not resolve host/,
    );
  } finally {
    await app.stop();
  }
});
