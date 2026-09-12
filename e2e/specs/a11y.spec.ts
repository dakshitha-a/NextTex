import AxeBuilder from "@axe-core/playwright";
import { test, expect, openFolders } from "../fixtures";
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

/** Contrast is measured on settled pixels.
 *
 *  Panels arrive with `.nx-arrive`, a 120ms fade from `opacity: 0`, and the
 *  update footer replays it every time its phase changes.  Sampling during
 *  one measures half-transparent text against the ground behind it and
 *  reports a contrast failure that no one can ever see -- which is what the
 *  sweep had been doing about one run in twenty, more often under the load
 *  of the full suite, and it cost two investigations before the cause was
 *  the ruler rather than the thing being measured.
 *
 *  Reduced motion rather than a wait: the app already answers it by turning
 *  animations off outright, so there is no transient to race, and an
 *  accessibility sweep is the right place to be asking for it anyway.  The
 *  colours it checks are the same either way.
 */
async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

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
    await settle(page);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText(/project/i).first().waitFor();
    const found = await violations(page);
    expect(describeAll(found)).toBe("");
  });

  test(`the editor is usable in the ${theme} theme`, async ({ page, tab }) => {
    await page.emulateMedia({ colorScheme: theme });
    await settle(tab);
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
  await openFolders(tab, "figures/plot.png");
  await expect(
    tab.getByRole("treeitem", { name: /plot\.png/ }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await tab.getByTestId("upload").click();
  await tab
    .locator("#nx-upload")
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
    .locator("#nx-upload")
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
    .locator("#nx-upload")
    .setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });
  await expect(tab.getByTestId("upload-staging")).toBeVisible({ timeout: 10_000 });
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("upload-staging")).toHaveCount(0);
  // Back where it started, rather than at the top of the document.
  await expect(tab.getByTestId("upload")).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`the tutorial is usable in the ${theme} theme`, async ({ page, tab }) => {
    await page.emulateMedia({ colorScheme: theme });
    await tab.getByTestId("appearance").click();
    await tab.getByTestId("tutorial-open").click();
    await expect(tab.getByTestId("tutorial")).toBeVisible();
    const found = await violations(tab);
    expect(describeAll(found)).toBe("");
  });

  test(`the projects guide is usable in the ${theme} theme`, async ({
    app,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${app.base}/?token=${app.token}`);
    // `/project/i`, as the test above it does: the screen's own words are
    // "Create project" and "A new project starts blank", never "Projects".
    await page.getByText(/project/i).first().waitFor();
    await page.getByTestId("about-screen").click();
    await expect(page.getByTestId("screen-guide")).toBeVisible();
    const found = await violations(page);
    expect(describeAll(found)).toBe("");
  });
}

test("Escape closes the tutorial and gives focus back to the cog", async ({
  tab,
}) => {
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("tutorial-open").click();
  await expect(tab.getByTestId("tutorial")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("tutorial")).toHaveCount(0);
  await expect(tab.getByTestId("appearance")).toBeFocused();
});

test("the tutorial stays open while you try what it describes", async ({
  tab,
}) => {
  // The property the whole shape rests on.  Every other card in this app
  // dismisses on an outside press; a tutorial that says "click a pane
  // header to fold it" and then vanishes when you do is worse than none.
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("tutorial-open").click();
  await expect(tab.getByTestId("tutorial")).toBeVisible();

  await tab.getByTestId("preview-header").click({ position: { x: 20, y: 16 } });
  await expect(tab.getByTestId("collapsed-preview")).toBeVisible();
  await expect(tab.getByTestId("tutorial")).toBeVisible();
});

test("the tutorial contents are one tab stop, walked with the arrows", async ({
  tab,
}) => {
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("tutorial-open").click();

  // The index is one row until it is asked for: eleven entries above the
  // fold is a third of the sheet spent on a list of places nobody has been
  // yet.  The row that opens it is what takes focus.
  const open = tab.getByTestId("tutorial-contents");
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(tab.getByTestId("tutorial-contents-row")).toHaveCount(0);

  await tab.keyboard.press("Enter");
  const rows = tab.getByTestId("tutorial-contents-row");
  // Focus lands on the section you are in, so the first arrow moves from
  // where you are rather than from the top.
  await expect(rows.first()).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("tabindex", "-1");
  await tab.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();

  // Choosing takes you there and gives the sheet back.
  await tab.keyboard.press("Enter");
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await expect(open).toBeFocused();
});

// R-028 and R-010. `nested-interactive`, impact serious, on five surfaces
// with one mechanism between them: an element carrying `role="button"`
// with a real `<button>` inside it. Assistive technology is told the outer
// element is one button, and the inner control is either unreachable or
// folded into its name. None of these surfaces had ever been swept,
// because opening each one takes a step the earlier sweeps did not take.

test("the diagnostics drawer is usable", async ({ tab }) => {
  // An error first, because the drawer opens from the status control and
  // that control is disabled in the states where it opens nothing:
  // clicking it on a clean build waits for a button that will never be
  // enabled, which is R-003 working. So the sweep has to earn its error.
  //
  // The same keystrokes and the same wait as `layout.spec.ts` uses to
  // open this drawer, rather than a variation of my own: the state to
  // wait for is `errors`, not `failed`, and an undefined control sequence
  // typed at the end of the document does not always reach the build
  // before the strip settles.
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("End");
  await tab.keyboard.type("\n\\badcommand{x}\n");
  const status = tab.getByTestId("status");
  await expect(status).toHaveAttribute("data-state", /error|warn/, {
    timeout: 30_000,
  });
  await settle(tab);
  await status.click();
  await expect(tab.getByTestId("diagnostics")).toBeVisible({ timeout: 20_000 });
  expect(describeAll(await violations(tab))).toBe("");
});

test("a file row's menu is usable", async ({ tab }) => {
  await settle(tab);
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.hover();
  await tab
    .locator('[data-path="main.tex"] [aria-label^="Actions for"]')
    .first()
    .click();
  await expect(tab.getByTestId("file-menu")).toBeVisible();
  expect(describeAll(await violations(tab))).toBe("");
});

test("the history panel is usable", async ({ tab }) => {
  // A version first: a project that has never been typed in has no
  // history, and an empty panel is not the surface this is about.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA sentence worth keeping.");
  await tab.waitForTimeout(2500);

  await settle(tab);
  await tab.locator('[data-path="main.tex"] [aria-label^="Actions for"]').first()
    .click();
  await tab.getByRole("button", { name: /History/i }).first().click();
  await expect(tab.getByTestId("version").first()).toBeVisible({ timeout: 20_000 });
  expect(describeAll(await violations(tab))).toBe("");
});

test("the agent panel mid-turn is usable", async ({ tab }) => {
  await settle(tab);
  const composer = tab.locator("textarea");
  await composer.click();
  await composer.fill("#script:working\nRead the theory chapter.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByTestId("working")).toBeVisible({ timeout: 20_000 });
  expect(describeAll(await violations(tab))).toBe("");
});

test("the download menu is usable", async ({ tab }) => {
  // The fifth surface on the record's list. The other four were reached by
  // the sweep and two of them were wrong; this one had never been opened
  // while axe was watching, so the strike would have been claiming a
  // surface nobody checked.
  await settle(tab);
  await tab.getByTestId("open-download").click();
  await expect(tab.getByTestId("download-menu")).toBeVisible();
  expect(describeAll(await violations(tab))).toBe("");
});
