import { test, expect } from "../fixtures";

/** The kit, measured on real surfaces.
 *
 *  The visual overhaul put every primitive under frontend/src/ui on one
 *  scale: radii 4 (controls), 8 (menus and cards), 12 (sheets); heights 28
 *  (controls) and 32 (rows); one family, Source Sans 3; planes separated by
 *  tone rather than hairlines.  The unit tests in ui/kit.test.tsx render
 *  the primitives on their own; these open the surfaces a writer actually
 *  sees and read what the browser painted, because a token that is
 *  defined and not applied measures nothing.
 */

const style = (page: any, selector: string, property: string) =>
  page.locator(selector).first().evaluate(
    (el: Element, prop: string) => getComputedStyle(el).getPropertyValue(prop),
    property,
  );

test("the two strips under the panes are one 28 px edge", async ({ tab }) => {
  // The status strip and the preview's strip meet at the split, so they
  // are the same height, the same ground and both without a rule above
  // them, or the bottom of the window ends in a step.
  await tab.setViewportSize({ width: 1600, height: 1000 });
  const status = tab.getByTestId("status-strip");
  const preview = tab.getByTestId("preview-footer");
  await expect(status).toBeVisible();
  await expect(preview).toBeVisible();
  for (const strip of [status, preview]) {
    const box = (await strip.boundingBox())!;
    expect(Math.round(box.height), "a strip is not 28 px").toBe(28);
  }
  expect(await style(tab, "[data-testid=status-strip]", "background-color")).toBe(
    await style(tab, "[data-testid=preview-footer]", "background-color"),
  );
  expect(await style(tab, "[data-testid=status-strip]", "border-top-width")).toBe("0px");
  expect(await style(tab, "[data-testid=preview-footer]", "border-top-width")).toBe("0px");
  // What left the status strip: the path (the tab names the file), the
  // repository line and History (both drawers).
  await expect(status.getByRole("button", { name: "History" })).toHaveCount(0);
  await expect(status).not.toContainText("main.tex");
  // And the preview's strip says Download where it said Save, since the
  // header's menu already says Download for the same file.
  await expect(preview.getByTestId("save-pdf")).toHaveText("Download", { timeout: 60_000 });
});

test("a menu is the kit's card: 8 px radius, no border, the sans", async ({ tab }) => {
  await tab.getByTestId("open-download").click();
  const menu = tab.getByTestId("download-menu");
  await expect(menu).toBeVisible();
  expect(await style(tab, "[data-testid=download-menu]", "border-top-left-radius")).toBe("8px");
  expect(await style(tab, "[data-testid=download-menu]", "border-top-width")).toBe("0px");
  expect(await style(tab, "[data-testid=download-menu]", "font-family")).toContain("Source Sans 3");
  await tab.keyboard.press("Escape");
});

test("a sheet is the kit's sheet: 12 px radius on the scrim", async ({ tab }) => {
  await tab.getByRole("button", { name: /share/i }).first().click();
  const sheet = tab.getByTestId("share-panel");
  await expect(sheet).toBeVisible();
  expect(await style(tab, "[data-testid=share-panel]", "border-top-left-radius")).toBe("12px");
  await tab.keyboard.press("Escape");
});

test("the kit's controls are 28 px and the strip's segments 20 px", async ({ tab }) => {
  // An icon button in the title bar, and the small segmented control under
  // the preview: the two heights the direction fixes for controls.
  const share = (await tab.getByTestId("open-share").boundingBox())!;
  expect(Math.round(share.height)).toBe(28);
  const scroll = tab.getByTestId("preview-footer").getByRole("button", { name: "Scroll" });
  const box = (await scroll.boundingBox())!;
  expect(Math.round(box.height)).toBe(20);
  await expect(scroll).toHaveAttribute("aria-pressed", "true");
});
