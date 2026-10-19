import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { startServer, type Instance } from "../server";

/** The diagnostics log, end to end: what the browser sees reaches the
 *  server's `diagnostics.log` without the writer pressing anything.
 *
 *  `frontend/src/errors.ts` has kept a ring of the page's errors for the
 *  bug report since the report existed, and nothing else ever saw them.
 *  Now they are sent as they happen, and once more as the page goes, and
 *  `nexttex/diag.py` writes them beside the server's own record. */

let app: Instance;

test.beforeAll(async () => {
  app = await startServer();
});

test.afterAll(async () => {
  await app?.stop();
});

function lines(): Record<string, unknown>[] {
  const path = join(app.sandbox, "data", "nexttex", "diagnostics.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").filter(Boolean).map((row) => JSON.parse(row));
}

test("the server starts its log, and a page's error lands in it", async ({ page }) => {
  expect(lines().find((row) => row.kind === "start")).toBeTruthy();

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error(`planted for the log at ${window.location.href}`);
    });
  });

  await expect.poll(() => lines().filter((row) => row.kind === "client").length, {
    timeout: 15_000,
  }).toBeGreaterThan(0);
  const [error] = lines().filter((row) => row.kind === "client");
  expect(String(error.message)).toContain("planted for the log");
  // The page's address carried the token on the way in; the log never does.
  expect(JSON.stringify(lines())).not.toContain(app.token);
});

test("what is unsent goes as the page is left", async ({ page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const before = lines().filter((row) => row.kind === "client").length;
  await page.evaluate(() => {
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("left behind at the door"),
    }));
  });
  await page.goto("about:blank");
  await expect.poll(() => lines().filter((row) => row.kind === "client").length, {
    timeout: 15_000,
  }).toBeGreaterThan(before);
  expect(lines().some((row) => String(row.message).includes("left behind at the door")))
    .toBe(true);
});
