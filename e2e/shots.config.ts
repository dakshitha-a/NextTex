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
    // Every screen in this repository had been photographed at a ratio of
    // 1 or 2. A Windows laptop at the ordinary 125 per cent scaling
    // renders at 1.25, and the clarity work here is specifically about
    // whole-pixel alignment, gutters and hairlines: a rule that lands on
    // a pixel boundary at 1 and at 2 lands between pixels at 1.25, which
    // is where whole-pixel reasoning stops holding. Set it here, once, so
    // a whole sweep can be re-taken at a fractional ratio by exporting
    // one variable.
    deviceScaleFactor: Number(process.env.NEXTTEX_SHOT_DPR ?? 1),
    trace: "off",
    video: "off",
  },
});
