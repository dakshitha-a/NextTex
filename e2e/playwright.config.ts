import { defineConfig } from "@playwright/test";
import { chromePath } from "./browser";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // Six at a time.  Each worker runs one NextTex that its tests share
  // (fixtures.ts), a Chromium and the LaTeX builds its tests start, and
  // six of those fit an eight-core machine with room for the builds; the
  // whole tier took an hour at two, with a server started for every test.
  // NEXTTEX_E2E_WORKERS sets another number for a machine that is busy or
  // smaller.
  workers: Number(process.env.NEXTTEX_E2E_WORKERS) || 6,
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
  // Two projects rather than one, and the default keeps every setting it had
  // so no existing spec has to be re-tagged or re-timed.
  //
  // The tablet is a browser on the tailnet reaching an install that stays on
  // its own machine: nothing is installed on a tablet, and a tablet in
  // landscape is the honest target rather than a phone.  Deliberately not a
  // spread of `devices["iPad ..."]`, because those carry
  // `defaultBrowserType: "webkit"` and this tier launches a pinned Chromium.
  projects: [
    {
      name: "desktop",
      testIgnore: /touch\.spec\.ts/,
    },
    {
      name: "tablet",
      testMatch: /touch\.spec\.ts/,
      use: {
        viewport: { width: 1180, height: 820 },
        hasTouch: true,
        isMobile: false,
        deviceScaleFactor: 2,
      },
    },
  ],
});
