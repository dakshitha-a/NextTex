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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("the upload chooser is announced, including its conflicts", async ({
  app, project, tab,
}) => {
  await tab.evaluate(
    async ({ base, token, id }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({
          path: "figures/plot.png", text: "x\n", compile: false, create: true,
        }),
      });
    },
    { base: app.base, token: app.token, id: project.id },
  );
  await expect(
    tab.getByRole("treeitem", { name: /plot\.png/ }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await tab.getByTestId("upload").click();
  await tab
    .locator('input[type="file"]')
    .setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });
  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await chooser.getByRole("button", { name: /Into/ }).click();
  await chooser.getByRole("option", { name: "figures" }).click();
  await expect(chooser.getByText("1 file is already there.")).toBeVisible();

  const found = await violations(tab);
  expect(describeAll(found)).toBe("");
});

test("the folder list can be worked without a mouse", async ({ tab }) => {
  await tab.getByTestId("upload").click();
  await tab
    .locator('input[type="file"]')
    .setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });
  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });

  // Focus lands on the destination, because "where" is the first question.
  await expect(chooser.getByRole("button", { name: /Into/ })).toBeFocused();
  await tab.keyboard.press("Enter");
  await expect(chooser.getByRole("listbox")).toBeVisible();

  // Selection follows focus, which is allowed for a single-select list and
  // is one keystroke to reverse.
  await chooser.getByRole("listbox").focus();
  await tab.keyboard.press("ArrowDown");
  await expect(
    chooser.getByRole("option", { name: "figures" }),
  ).toHaveAttribute("aria-selected", "true");
  await tab.keyboard.press("Enter");
  await expect(chooser.getByRole("listbox")).toHaveCount(0);
  await expect(chooser.getByRole("button", { name: /Into/ })).toContainText(
    "figures",
  );
});

test("Escape closes the chooser and gives focus back", async ({ tab }) => {
  await tab.getByTestId("upload").click();
  await tab
    .locator('input[type="file"]')
    .setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });
  await expect(tab.getByTestId("upload-staging")).toBeVisible({ timeout: 10_000 });
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("upload-staging")).toHaveCount(0);
  // Back where it started, rather than at the top of the document.
  await expect(tab.getByTestId("upload")).toBeFocused();
});
