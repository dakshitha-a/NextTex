import { defineConfig } from "@playwright/test";
import { chromePath } from "../browser";

/** Points at the long-lived live server; starts nothing of its own. */
export default defineConfig({
  testDir: ".",
  testMatch: /a7-live2\.spec\.ts/,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: chromePath() },
    trace: "off",
    video: "off",
  },
});
