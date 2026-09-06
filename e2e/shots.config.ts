import { defineConfig } from "@playwright/test";
import { chromePath } from "./browser";

/** The README's screenshots.  Its own config so an ordinary run never
 *  picks them up: they write files into the repository, and one at a time
 *  keeps the two hero shots identical apart from the theme. */
export default defineConfig({
  testDir: "./shots",
  globalSetup: "./global-setup.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    viewport: { width: 1680, height: 1000 },
    launchOptions: { executablePath: chromePath() },
    trace: "off",
    video: "off",
  },
});
