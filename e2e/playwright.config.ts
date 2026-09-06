import { defineConfig } from "@playwright/test";
import { chromePath } from "./browser";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // The specs each start their own NextTex, so they are genuinely
  // independent -- but each one is a real server and a real LaTeX build,
  // so two at a time is plenty on one machine.
  workers: 2,
  // One retry, and it is not papering over flakiness in the app.  Each
  // spec starts a real server and runs a real LaTeX build; two of those at
  // once on a loaded machine occasionally pushes a compile past a timeout
  // that is generous when the machine is idle.  A genuine failure still
  // fails twice, so nothing intermittent gets through -- and the report
  // says which tests needed the second attempt, which is the signal worth
  // watching.
  retries: 1,
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
