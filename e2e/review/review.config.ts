import { defineConfig } from "@playwright/test";
import { chromePath } from "../browser";

/** Scratch config for the September review.  Not a check: these specs drive
 *  the app, photograph it and print what they saw, for a person to read. */
export default defineConfig({
  testDir: ".",
  globalSetup: "../global-setup.ts",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: chromePath() },
    trace: "off",
    video: "off",
  },
});
