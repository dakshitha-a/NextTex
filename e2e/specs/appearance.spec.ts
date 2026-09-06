import { test, expect } from "../fixtures";

/** The settings card: theme, interface size, editor text size, and the
 *  three per-project switches.
 *
 *  The interface size is a `zoom` on the shell, which leaves the app
 *  straddling two coordinate spaces: reads come back in viewport pixels,
 *  writes are interpreted in zoomed ones.  Everything here that looks like
 *  it is testing arithmetic is testing that boundary.
 */

async function open(page: import("@playwright/test").Page) {
  await page.getByTestId("appearance").first().click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test("the editor text can be made bigger and stays that way", async ({ tab }) => {
  const scroller = tab.locator(".cm-scroller");
  const before = await scroller.evaluate((el) => getComputedStyle(el).fontSize);
  expect(before).toBe("13.5px");

  await open(tab);
  await tab.getByRole("button", { name: "Larger editor text" }).click();
  await expect(scroller).toHaveCSS("font-size", "15px");

  // The line height has to follow, or 21px text sits in a 22px line.
  const ratio = await scroller.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  });
  expect(ratio).toBeGreaterThan(1.5);

  await tab.reload();
  await expect(tab.locator(".cm-scroller")).toHaveCSS("font-size", "15px");
});

test("the interface scales, and the projects screen scales with it", async ({
  tab,
}) => {
  await open(tab);
  await tab.getByRole("button", { name: "Larger interface" }).click();
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1.1");

  // The whole point of putting it on #root: it covers the screens that
  // return before the editor shell is ever built.
  await tab.getByTestId("switch-project").click();
  await expect(tab.getByRole("heading", { name: "NextTex" })).toBeVisible();
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1.1");
  await expect(tab.getByTestId("appearance")).toBeVisible();
});

test("a bigger interface does not soften the page", async ({ tab }) => {
  // `zoom` changes how many device pixels a CSS pixel covers, but not
  // `devicePixelRatio`.  A canvas sized for the old ratio is stretched by
  // the browser, and a blurry preview is the one thing this pane cannot
  // ship.
  const canvas = tab.locator(".pdf-page canvas, canvas").first();
  await canvas.waitFor({ timeout: 30_000 });
  const before = await canvas.evaluate((el) => (el as HTMLCanvasElement).width);

  await open(tab);
  for (const _ of [0, 1, 2]) {
    await tab.getByRole("button", { name: "Larger interface" }).click();
  }
  await tab.keyboard.press("Escape");
  // The redraw is debounced behind the relayout.
  await expect
    .poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width), {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
});

test("reset puts everything back", async ({ tab }) => {
  await open(tab);
  await tab.getByRole("button", { name: "Larger editor text" }).click();
  await tab.getByRole("button", { name: "Larger interface" }).click();
  await tab.getByRole("button", { name: "Light" }).click();

  await tab.getByRole("button", { name: "Reset appearance" }).click();
  await expect(tab.locator(".cm-scroller")).toHaveCSS("font-size", "13.5px");
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1");
  await expect(tab.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a floating card still lands on screen at a larger interface", async ({
  tab,
}) => {
  await open(tab);
  for (const _ of [0, 1, 2]) {
    await tab.getByRole("button", { name: "Larger interface" }).click();
  }
  await tab.keyboard.press("Escape");

  // The file menu clamps itself against the viewport.  Its position is read
  // in viewport pixels and written in zoomed ones, so at 150% an unconverted
  // clamp puts it off the right-hand edge.
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.hover();
  await row.getByRole("button", { name: /Actions for/ }).click();
  const menu = tab.getByTestId("file-menu");
  await menu.waitFor({ timeout: 5000 });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1680 + 1);
});

test("the project switches are absent when there is no project", async ({ tab }) => {
  // Absent rather than disabled.  A control that cannot be enabled from
  // where you are standing advertises a capability and then refuses, and
  // three switches with no project would be lying about which project they
  // belonged to.
  await open(tab);
  await expect(tab.getByRole("switch", { name: "Compile as you type" })).toBeVisible();
  await tab.keyboard.press("Escape");

  await tab.getByTestId("switch-project").click();
  await expect(tab.getByRole("heading", { name: "NextTex" })).toBeVisible();
  await open(tab);
  // Scoped to the card: leaving the editor does not clear `projectId` --
  // the app keeps it so a reload comes back to the document -- so this has
  // to be about what the card decided to draw, not about the whole page.
  const card = tab.getByRole("dialog", { name: "Settings" });
  await expect(card.getByText("This project")).toHaveCount(0);
  await expect(card.getByRole("switch")).toHaveCount(0);
  // The appearance half is still there, and still says what it resets.
  await expect(card.getByRole("button", { name: "Reset appearance" })).toBeVisible();
});

test("turning off compile as you type stops builds, and leaves a button", async ({
  tab,
}) => {
  // Let the build that runs on opening finish first.
  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), {
      timeout: 45_000,
    })
    .toBe("built");

  await open(tab);
  await tab.getByRole("switch", { name: "Compile as you type" }).click();
  await tab.keyboard.press("Escape");

  // The build control renames itself: with nothing building by itself, it
  // is the primary action rather than a fallback.
  await expect(tab.getByRole("button", { name: "Compile" })).toBeVisible();

  await tab.locator(".cm-content").click();
  await tab.keyboard.type("A sentence typed with autocompile off.");
  // The dot says the preview is behind, and stays there: with the switch
  // off, that is a resting state rather than a second and a half.
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "stale");
  await tab.waitForTimeout(4000);
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "stale");

  // And the button does what nothing else will now do.  What the build
  // *says* is not the point -- typing lands wherever the caret was, which
  // may well break the document -- only that one ran at all.
  await tab.getByRole("button", { name: "Compile" }).click();
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "compiling");
  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), {
      timeout: 45_000,
    })
    .not.toBe("compiling");
  await expect(tab.getByTestId("status")).not.toHaveAttribute("data-state", "stale");
});

test("a keystroke during a build is not forgotten when the build lands", async ({
  tab,
}) => {
  // Clearing staleness when a build *finishes* would wipe exactly this: the
  // preview that has just arrived is already behind the text that was typed
  // while it was being made.
  //
  // Done with compile-as-you-type off, so that nothing else can start a
  // build and clear the flag legitimately -- with it on, this is a race
  // against a 1.6 second debounce rather than a test.
  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), {
      timeout: 45_000,
    })
    .toBe("built");

  await open(tab);
  await tab.getByRole("switch", { name: "Compile as you type" }).click();
  await tab.keyboard.press("Escape");

  await tab.getByRole("button", { name: "Compile" }).click();
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "compiling");

  await tab.locator(".cm-content").click();
  await tab.keyboard.type("Typed while it was building.");

  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), {
      timeout: 45_000,
    })
    .toBe("stale");
});
