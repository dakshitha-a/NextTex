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

/** How far the canvas is from carrying one device pixel per pixel it shows.
 *
 *  This is the invariant the whole pane rests on: the backing store should be
 *  the box it is painted into, times the device ratio, times the interface
 *  scale.  Anything else is a bitmap the browser has to stretch or squash,
 *  which is what a soft page is.
 */
async function rasterError(canvas: import("@playwright/test").Locator) {
  return canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const box = canvasElement.getBoundingClientRect();
    const scale = Number(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--nx-ui-scale",
      ) || 1,
    );
    // `getBoundingClientRect` is in zoomed pixels, so the interface scale is
    // already in it: undo it to get the CSS box, then ask for it back.
    const wanted = (box.width / scale) * window.devicePixelRatio * scale;
    return Math.abs(canvasElement.width - wanted);
  });
}

test("the page is drawn at the resolution it is shown at", async ({ tab }) => {
  // This assertion used to be that the backing store grew after stepping the
  // interface up, which is not an invariant of anything: in fit-width mode a
  // larger interface shrinks the CSS box and raises the resolution, so the
  // store barely moves.  It also selected `.pdf-page canvas`, and the class
  // this pane renders is `nx-page`, so it matched nothing and fell through to
  // a bare canvas.  A correctly-selected wrong assertion is worse than an
  // obviously broken one, because it looks like coverage.
  //
  // What is asserted instead is the thing the defects violated, and it was
  // watched to fail: against the previous pane it measures exactly 2, which
  // is the width of the page's own border.  The container was 441 wide, the
  // canvas inside it 439, and the backing store was sized from the container,
  // so every page was drawn two device pixels wide of the box it was shown
  // in and squashed to fit.  It measures 0 now.
  const canvas = tab.locator(".nx-page canvas").first();
  await canvas.waitFor({ timeout: 30_000 });
  await expect.poll(async () => rasterError(canvas), { timeout: 15_000 }).toBeLessThan(2);

  await open(tab);
  for (const _ of [0, 1, 2]) {
    await tab.getByRole("button", { name: "Larger interface" }).click();
  }
  await tab.keyboard.press("Escape");
  await expect.poll(async () => rasterError(canvas), { timeout: 15_000 }).toBeLessThan(2);
});

test("a page drawn on one screen is redrawn for another", async ({ tab }) => {
  // Moving a window to a display of a different density changes
  // `devicePixelRatio` and nothing else: no resize, no relayout, no event
  // this pane was listening for.  The page kept whatever ratio it was drawn
  // with and the browser stretched it from then on.  A CDP metrics override
  // is the same change arriving the same way.
  const canvas = tab.locator(".nx-page canvas").first();
  await canvas.waitFor({ timeout: 30_000 });
  await expect.poll(async () => rasterError(canvas), { timeout: 15_000 }).toBeLessThan(2);

  const session = await tab.context().newCDPSession(tab);
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 0,
    height: 0,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await expect.poll(async () => rasterError(canvas), { timeout: 15_000 }).toBeLessThan(2);
  await session.send("Emulation.clearDeviceMetricsOverride");
});

test("the preview quality setting changes what a page is drawn with", async ({
  tab,
}) => {
  const canvas = tab.locator(".nx-page canvas").first();
  await canvas.waitFor({ timeout: 30_000 });
  const width = async () =>
    canvas.evaluate((el) => (el as HTMLCanvasElement).width);
  const balanced = await width();

  await open(tab);
  // A pressed-state button rather than a radio, so `check` cannot drive it.
  await tab.getByTestId("preview-sharper").click();
  await tab.keyboard.press("Escape");
  await expect.poll(width, { timeout: 15_000 }).toBeGreaterThan(balanced);

  await open(tab);
  await tab.getByTestId("preview-faster").click();
  await tab.keyboard.press("Escape");
  await expect.poll(width, { timeout: 15_000 }).toBeLessThanOrEqual(balanced);
});

test("reset puts everything back", async ({ tab }) => {
  await open(tab);
  await tab.getByRole("button", { name: "Larger editor text" }).click();
  await tab.getByRole("button", { name: "Larger interface" }).click();
  // Scoped to the theme group: the editor now has a light/dark toggle of
  // its own directly below, and "Light" alone no longer names one button.
  await tab
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name: "Light" })
    .click();

  await tab.getByRole("button", { name: "Reset appearance" }).click();
  await expect(tab.locator(".cm-scroller")).toHaveCSS("font-size", "13.5px");
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1");
  await expect(tab.locator("html")).toHaveAttribute("data-theme", "dark");
});

const WIDE = 1700;

test("a floating card still lands on screen at a larger interface", async ({
  tab,
}) => {
  // Wide enough that the layout still has its 1100px at 150%, since 1700
  // divided by 1.5 is 1133.  The window has to be given that room now that
  // a change of interface size is measured when it happens rather than at
  // the next time the window is dragged: at the default 1600 the layout is
  // down to 1067px at 150% and the file rail correctly folds itself away,
  // taking with it the row this opens a menu from.
  await tab.setViewportSize({ width: WIDE, height: 1000 });
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
  expect(box!.x + box!.width).toBeLessThanOrEqual(WIDE + 1);
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

test("the editor can be lit apart from the rest of the app", async ({ tab }) => {
  // A dark shell around a white page is the point: what is being lit
  // differently is the document, not the app around it.
  await tab.getByTestId("appearance").click();
  await tab.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await tab.getByTestId("editor-theme-light").click();

  const editorBackground = await tab
    .locator(".cm-editor")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const railBackground = await tab
    .locator('[role="tree"]')
    .evaluate((node) => getComputedStyle(node).backgroundColor);

  // The editor is light, the shell is not.
  const lightness = (colour: string) =>
    colour.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
  expect(lightness(editorBackground)).toBeGreaterThan(180);
  expect(lightness(railBackground)).toBeLessThan(80);

  // And the syntax colours followed it, rather than staying the dark
  // theme's inks on a white page.
  const ink = await tab
    .locator(".cm-content")
    .evaluate((node) => getComputedStyle(node).color);
  expect(lightness(ink)).toBeLessThan(90);
});

test("matching is the default, and putting it back matches again", async ({
  tab,
}) => {
  await tab.getByTestId("appearance").click();
  await tab.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await tab.getByTestId("editor-theme-light").click();
  await tab.getByTestId("editor-theme-match").click();

  const editorBackground = await tab
    .locator(".cm-editor")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const lightness = (colour: string) =>
    colour.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
  expect(lightness(editorBackground)).toBeLessThan(80);
});

test("an editor lit on its own terms survives a reload", async ({ tab }) => {
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("editor-theme-light").click();
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  const editorBackground = await tab
    .locator(".cm-editor")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const lightness = (colour: string) =>
    colour.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
  expect(lightness(editorBackground)).toBeGreaterThan(180);
});

/** Colouring the control sequences.
 *
 *  The families cannot be told apart by the token the LaTeX mode reports --
 *  it calls `\section`, `\cite` and `\usepackage` the same thing -- so what
 *  these check is that the decoration layer put the right class on the right
 *  word and that the CSS resolved it, which is the pair that has to hold.
 */
async function typeSomeLaTeX(tab: import("@playwright/test").Page) {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Home");
  await tab.keyboard.type("\\section{Heading} \\cite{key} \\usepackage{amsmath}\n");
}

const colourOf = (node: Element) => getComputedStyle(node).color;

test("the subtle look is what an editor opens with", async ({ tab }) => {
  await typeSomeLaTeX(tab);
  const ink = await tab.locator(".cm-content").evaluate(colourOf);
  // The marks are there whatever the setting says -- that is what makes the
  // switch a class on one element rather than a rebuild -- so the check is
  // that nothing styles them, not that they are absent.
  await expect(tab.locator(".nx-syn-structure").first()).toBeVisible();
  expect(await tab.locator(".nx-syn-structure").first().evaluate(colourOf)).toBe(ink);
  expect(await tab.locator(".nx-syn-cite").first().evaluate(colourOf)).toBe(ink);
  expect(await tab.locator(".nx-syn-preamble").first().evaluate(colourOf)).toBe(ink);

  // The heading after \section, specifically.  An earlier version set every
  // decorated argument to --ink-2, which is right for \cite{...} and
  // \begin{...} -- the LaTeX mode marks those as atoms -- but wrong for a
  // heading, which it does not tokenise at all.  Every title in the
  // document dimmed a step in the mode that is meant to be untouched, and
  // no colour assertion could see it, because both shades are grey.
  expect(
    await tab.locator(".nx-syn-arg-structure").first().evaluate(colourOf),
    "the heading dimmed with colouring off",
  ).toBe(ink);
});

test("colour tells the families apart, and each one differs from the text", async ({
  tab,
}) => {
  await typeSomeLaTeX(tab);
  const ink = await tab.locator(".cm-content").evaluate(colourOf);

  await tab.getByTestId("appearance").click();
  await tab.getByTestId("syntax-colour").click();
  await tab.keyboard.press("Escape");

  const seen = new Set<string>();
  for (const family of ["structure", "cite", "preamble"]) {
    const colour = await tab.locator(`.nx-syn-${family}`).first().evaluate(colourOf);
    expect(colour, `--syn-${family} still reads as body text`).not.toBe(ink);
    seen.add(colour);
  }
  // Three families, three colours: two that resolved to the same value
  // would make the setting decorative rather than useful.
  expect(seen.size).toBe(3);
});

test("the colours follow the page, not the frame", async ({ tab }) => {
  await typeSomeLaTeX(tab);
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("syntax-colour").click();
  await tab.getByRole("group", { name: "Theme" })
    .getByRole("button", { name: "Dark" }).click();

  const lightness = (colour: string) =>
    colour.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
  const onDark = await tab.locator(".nx-syn-structure").first().evaluate(colourOf);

  // A white page inside a dark shell has to take the light palette's
  // syntax colours, or they are the dark theme's brights on white.
  await tab.getByTestId("editor-theme-light").click();
  const onLight = await tab.locator(".nx-syn-structure").first().evaluate(colourOf);
  expect(lightness(onLight)).toBeLessThan(lightness(onDark));
});

test("colouring survives a reload", async ({ tab }) => {
  await typeSomeLaTeX(tab);
  await tab.getByTestId("appearance").click();
  await tab.getByTestId("syntax-colour").click();
  await tab.keyboard.press("Escape");
  const before = await tab.locator(".nx-syn-structure").first().evaluate(colourOf);

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.locator(".nx-syn-structure").first()).toBeVisible();
  expect(await tab.locator(".nx-syn-structure").first().evaluate(colourOf)).toBe(before);
});
