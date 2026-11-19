import { test, expect } from "../fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Reference lookups and hidden warnings, drawn on the direction page's
 *  #lookups section (19 November 2026). The thesis session's check was
 *  rate-limited by Crossref and read as 236 bad references, and its
 *  standalone chapters' builds were full of a warning it could do
 *  nothing about. */

test.describe("the contact for reference lookups", () => {
  // Install-wide state: the address goes into the install's settings.
  test.use({ ownServer: true });

  test("is given, saved and cleared in the install's settings", async ({ app, tab }) => {
    const kept = async () =>
      (await fetch(`${app.base}/api/settings/contact`, {
        headers: { "x-nexttex-token": app.token },
      })).json();
    await tab.getByTestId("appearance").click();
    await tab.getByTestId("settings-group-install").click();
    const row = tab.getByTestId("settings-contact");
    await expect(row).toContainText("Contact for reference lookups");
    await expect(row).toContainText("Sent to them only.");
    const field = tab.getByTestId("settings-contact-field");
    await expect(field).toHaveValue("");
    // Nothing to save until something is typed.
    await expect(tab.getByTestId("settings-contact-save")).toHaveCount(0);

    await field.fill("writer");
    await tab.getByTestId("settings-contact-save").click();
    await expect(row).toContainText("not an email address");

    await field.fill("a.writer@uni.ac.uk");
    await tab.getByTestId("settings-contact-save").click();
    await expect(tab.getByTestId("settings-contact-save")).toHaveCount(0);
    await expect(row).toContainText("Sent to them only.");
    expect(await kept()).toEqual({ address: "a.writer@uni.ac.uk", fromEnvironment: false });

    await field.fill("");
    await field.press("Enter");
    await expect(tab.getByTestId("settings-contact-save")).toHaveCount(0);
    await expect.poll(kept).toEqual({ address: "", fromEnvironment: false });
  });
});

test("a check that could not look entries up says so, apart from the problems", async ({
  tab, page,
}) => {
  await page.route("**/library/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        checked: 252,
        problems: [{ key: "Kumar2020", issues: ["title mismatch (62%) for doi:10.1021/acs.jpca.0c01234"] }],
        unchecked: Array.from({ length: 40 }, (_, at) => ["Cachon2021", "Smith2019", "Lee2020"][at] ?? `k${at}`),
        retry_after: 95,
        refusing: ["Crossref"],
        by_hand: [],
        report: "",
      }),
    }),
  );
  await tab.getByTestId("bar-papers").click();
  await expect(tab.getByTestId("papers-panel")).toBeVisible({ timeout: 20_000 });
  await tab.getByTestId("papers-verify").click();
  const unchecked = tab.getByTestId("papers-unchecked");
  await expect(unchecked).toContainText(
    "40 not checked: Crossref is refusing for now. Check again in about 2 minutes.",
  );
  await expect(unchecked).toContainText("Cachon2021, Smith2019, Lee2020, and 37 more");
  // Not one of the problems, and the problem is still there.
  await expect(tab.getByTestId("papers-problem")).toHaveCount(1);
  await expect(tab.getByTestId("papers-problem")).toContainText("Kumar2020");

  // With no problems, the first line counts only what was looked up.
  await page.unroute("**/library/verify");
  await page.route("**/library/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        checked: 10, problems: [], unchecked: ["a", "b"], retry_after: 30,
        refusing: [], by_hand: ["old"], report: "",
      }),
    }),
  );
  await tab.getByTestId("papers-verify").click();
  await expect(tab.getByTestId("papers-report-matched")).toHaveText("7 entries match their records.");
  await expect(tab.getByTestId("papers-unchecked")).toContainText(
    "2 not checked: their records could not be reached. Check again in about 1 minute.",
  );
});

test("a build warning can be hidden for its document, and shown again", async ({
  project, tab,
}) => {
  test.setTimeout(120_000);
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "main.tex"), [
    "\\documentclass{article}",
    "\\begin{document}",
    "Text.",
    "\\PackageWarning{demo}{Suppressing link with empty target}",
    "\\PackageWarning{demo}{A warning worth keeping}",
    "\\end{document}",
    "",
  ].join("\n"));
  await tab.getByTestId("bar-build").click();
  const drawer = tab.getByTestId("diagnostics");
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  await tab.getByTestId("build-rebuild").click();
  const noisy = drawer.getByText(/Suppressing link with empty target/);
  await expect(noisy).toBeVisible({ timeout: 60_000 });
  await expect(drawer.getByText(/A warning worth keeping/)).toBeVisible();

  // Opened, the row offers Hide under what it says; its end keeps Fix
  // and Copy alone, so no message is squeezed.
  const row = drawer.locator("div.group").filter({ hasText: "Suppressing link with empty target" });
  await expect(row.getByTestId("diagnostic-hide")).toHaveCount(0);
  await row.getByText("Suppressing link with empty target").click();
  await row.getByTestId("diagnostic-hide").click();
  await expect(noisy).toHaveCount(0);
  await expect(drawer.getByText(/A warning worth keeping/)).toBeVisible();
  await expect(tab.getByTestId("build-hidden")).toHaveText(/1 warning hidden in this document\./);
  expect(readFileSync(join(project.root, "nexttex.toml"), "utf-8")).toContain("[project.hide_warnings]");

  // A build after it leaves the warning out on the server's side, and
  // still says it did.
  await tab.getByTestId("build-rebuild").click();
  await expect(tab.getByTestId("build-hidden")).toHaveText(/1 warning hidden in this document\./, {
    timeout: 60_000,
  });
  await expect(noisy).toHaveCount(0);

  // Listed in Settings, This project.
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("settings-group-project").click();
  await expect(tab.getByTestId("settings-hidden-warnings")).toContainText(
    "main.tex: Suppressing link with empty target",
  );
  await tab.keyboard.press("Escape");

  // Show brings it back with the next build.
  await tab.getByTestId("build-hidden-show").click();
  await expect(noisy).toBeVisible({ timeout: 60_000 });
  await expect(tab.getByTestId("build-hidden")).toHaveCount(0);
  expect(readFileSync(join(project.root, "nexttex.toml"), "utf-8")).not.toContain("hide_warnings");
});
