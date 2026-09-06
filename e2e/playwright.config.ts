import { defineConfig } from "@playwright/test";
import { chromePath } from "./browser";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // The specs each start their own NextTex, so they are genuinely
  // independent -- but each one is a real server and a real LaTeX build,
  // so two at a time is plenty on one machine.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    // Wider than the 1400px the layout treats as narrow, so the specs see
    // the three-pane arrangement.  The narrow layouts have their own spec.
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: chromePath() },
    trace: "retain-on-failure",
    video: "off",
  },
});
