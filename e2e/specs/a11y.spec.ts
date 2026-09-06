import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Whether the app can be used by somebody who is not using a mouse, or
 *  whose eyes are not mine.
 *
 *  The allowlist below is the artefact worth reading: an accessibility test
 *  with no allowlist is a test that gets deleted the first time it is
 *  inconvenient, so anything consciously rejected is written down with its
 *  reason rather than quietly excluded.
 */

/** Rules deliberately not enforced, and why. */
const ALLOWED: string[] = [
  // .cm-scroller.  The rule wants a scrollable region to be focusable
  // itself; CodeMirror's scroller wraps .cm-content, which is a focusable
  // editable region and *is* how a keyboard reaches and scrolls the
  // document.  Satisfying the rule literally would add a second tab stop
  // that goes nowhere, which is worse for the person it exists for.
  "scrollable-region-focusable",
];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  return results.violations.filter(
    (violation) =>
      !ALLOWED.includes(violation.id) &&
      ["serious", "critical"].includes(violation.impact ?? ""),
  );
}

function describeAll(found: Awaited<ReturnType<typeof violations>>) {
  return found
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
    )
    .join("\n");
}

for (const theme of ["light", "dark"] as const) {
  test(`the project list is usable in the ${theme} theme`, async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText(/project/i).first().waitFor();
    const found = await violations(page);
    expect(describeAll(found)).toBe("");
  });

  test(`the editor is usable in the ${theme} theme`, async ({ page, tab }) => {
    await page.emulateMedia({ colorScheme: theme });
    await expect(tab.locator(".cm-editor")).toBeVisible();
    const found = await violations(tab);
    expect(describeAll(found)).toBe("");
  });
}

test("a permission card is announced, not just drawn", async ({ tab }) => {
  await tab.locator("textarea").fill("#script:permission\nRun the command.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByTestId("allow")).toBeVisible({ timeout: 20_000 });

  // The three answers are real buttons with real names, not icons: this is
  // the one control in the app where a mistaken click runs a command.
  for (const handle of ["allow", "always", "deny"]) {
    const button = tab.getByTestId(handle);
    await expect(button).toHaveRole("button");
    expect((await button.textContent())?.trim().length).toBeGreaterThan(2);
  }
  const found = await violations(tab);
  expect(describeAll(found)).toBe("");
});

test("Escape closes what it opens", async ({ tab }) => {
  await tab.getByLabel("Actions for main.tex").click();
  await expect(tab.getByRole("button", { name: "Rename" })).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByRole("button", { name: "Rename" })).toHaveCount(0);
});

test("the composer can be reached by keyboard from the editor", async ({ tab }) => {
  await tab.locator(".cm-content").click();
  // Escape first, because Tab inside CodeMirror indents rather than moving
  // focus -- which is right for a code editor and has to have a way out.
  await tab.keyboard.press("Escape");
  for (let press = 0; press < 40; press += 1) {
    await tab.keyboard.press("Tab");
    if (await tab.locator("textarea:focus").count()) return;
  }
  throw new Error("the composer is not reachable by tabbing");
});
