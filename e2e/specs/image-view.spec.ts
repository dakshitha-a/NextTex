import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Download, Page } from "@playwright/test";
import { test, expect, openFolders } from "../fixtures";
import { png } from "../png";

/** The image viewer: a figure of any size opens whole, the zoom ladder
 *  steps from what is on screen, and the file can be taken away from
 *  where it is being looked at.
 *
 *  The size is the point.  The viewer had `max-width: 100%` on the image
 *  and no width on the wrapper the percentage resolved against, so a
 *  plot exported at 300 dpi was drawn at its full seven thousand pixels
 *  inside a pane a tenth as wide, and Fit was a word in the footer.
 */

const WIDE = { w: 4000, h: 2400 };

function seed(root: string): void {
  mkdirSync(join(root, "figures"), { recursive: true });
  writeFileSync(join(root, "figures", "wide.png"), png(WIDE.w, WIDE.h));
  writeFileSync(join(root, "figures", "small.png"), png(120, 80));
}

/** The picture's box and the frame's, in the same pixels. */
async function boxes(tab: Page) {
  return tab.getByTestId("file-view").evaluate((view) => {
    const img = view.querySelector("img")!;
    const frame = img.closest(".overflow-auto")!;
    const picture = img.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    return {
      picture: { width: picture.width, height: picture.height },
      frame: { width: frame.clientWidth, height: frame.clientHeight },
      scrolls: frame.scrollWidth > frame.clientWidth || frame.scrollHeight > frame.clientHeight,
      left: picture.left - fr.left,
      natural: { w: img.naturalWidth, h: img.naturalHeight },
    };
  });
}

async function openImage(tab: Page, path: string) {
  await openFolders(tab, path);
  await tab.locator(`[role="tree"] [data-path="${path}"]`).click();
  const img = tab.getByTestId("file-view").locator("img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  // Sized once the load has answered, which is when the fit is known.
  await expect.poll(async () => (await boxes(tab)).natural.w, { timeout: 15_000 })
    .toBeGreaterThan(0);
  return img;
}

test.beforeEach(({ project }) => seed(project.root));

test("a huge figure opens whole, and the ladder steps from the fit", async ({ tab }) => {
  await openImage(tab, "figures/wide.png");

  const fitted = await boxes(tab);
  expect(fitted.natural).toEqual({ w: WIDE.w, h: WIDE.h });
  // Inside the frame on both axes, with nothing to scroll to.
  expect(fitted.picture.width).toBeLessThanOrEqual(fitted.frame.width);
  expect(fitted.picture.height).toBeLessThanOrEqual(fitted.frame.height);
  expect(fitted.scrolls).toBe(false);
  // And not shrunk beyond what the frame asks for: the tighter axis is
  // filled to within the frame's own padding.
  const fill = Math.max(
    fitted.picture.width / fitted.frame.width,
    fitted.picture.height / fitted.frame.height,
  );
  expect(fill).toBeGreaterThan(0.8);
  await expect(tab.getByTestId("image-zoom")).toHaveText("Fit");

  // One rung up from a fit of about a tenth is 25%, not 100%: a figure
  // that filled the pane used to jump to four thousand pixels on the
  // first press.
  await tab.getByTestId("image-zoom-in").click();
  await expect(tab.getByTestId("image-zoom")).toHaveText("25%");
  expect((await boxes(tab)).picture.width).toBeCloseTo(WIDE.w * 0.25, 0);

  await tab.getByTestId("image-fit").click();
  await expect(tab.getByTestId("image-zoom")).toHaveText("Fit");
  expect((await boxes(tab)).picture.width).toBeCloseTo(fitted.picture.width, 0);

  // Zooming out from a fit that is already below the lowest rung has
  // nowhere to go and stays Fit rather than enlarging the picture.
  await tab.getByTestId("image-zoom-out").click();
  await expect(tab.getByTestId("image-zoom")).toHaveText("Fit");
});

test("the fit follows the frame when the window changes", async ({ tab }) => {
  await openImage(tab, "figures/wide.png");
  const before = await boxes(tab);

  await tab.setViewportSize({ width: 1100, height: 700 });
  await expect
    .poll(async () => (await boxes(tab)).picture.width, { timeout: 5_000 })
    .toBeLessThan(before.picture.width);
  const after = await boxes(tab);
  expect(after.picture.width).toBeLessThanOrEqual(after.frame.width);
  expect(after.picture.height).toBeLessThanOrEqual(after.frame.height);
  expect(after.scrolls).toBe(false);
});

test("a small figure is shown at its own size, not blown up", async ({ tab }) => {
  await openImage(tab, "figures/small.png");
  const shown = await boxes(tab);
  expect(shown.picture.width).toBeCloseTo(120, 0);
  await expect(tab.getByTestId("image-zoom")).toHaveText("Fit");
  await tab.getByTestId("image-zoom-in").click();
  // From 100%, the next rung is 150%.
  await expect(tab.getByTestId("image-zoom")).toHaveText("150%");
  expect((await boxes(tab)).picture.width).toBeCloseTo(180, 0);
});

/** The bytes a download delivered, read back from where the browser put
 *  them. */
async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  return readFileSync(path!);
}

test("a PNG can be downloaded from the viewer, the tree and its history", async ({
  tab, app, project,
}) => {
  const expected = png(WIDE.w, WIDE.h);
  await openImage(tab, "figures/wide.png");

  // From the viewer's own footer, beside the picture.
  let waiting = tab.waitForEvent("download");
  await tab.getByTestId("image-download").click();
  let download = await waiting;
  expect(download.suggestedFilename()).toBe("wide.png");
  expect((await bytesOf(download)).equals(expected)).toBe(true);

  // From the tree's row menu, which is where it always was.
  const row = tab.locator('[role="tree"] [data-path="figures/wide.png"]');
  await row.hover();
  await row.getByLabel("Actions for wide.png").click();
  waiting = tab.waitForEvent("download");
  await tab.getByTestId("file-menu").getByRole("button", { name: "Download", exact: true }).click();
  download = await waiting;
  expect(download.suggestedFilename()).toBe("wide.png");
  expect((await bytesOf(download)).equals(expected)).toBe(true);

  // From the history of the file, for a version that is no longer the
  // one on disk.  A second upload under the same name makes one.
  await row.hover();
  await row.getByLabel("Actions for wide.png").click();
  await tab.getByTestId("file-menu").getByRole("button", { name: "Upload here" }).click();
  await tab.locator("#nx-upload").setInputFiles({
    name: "wide.png", mimeType: "image/png", buffer: png(200, 100),
  });
  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await expect(chooser).toContainText("already there");
  await chooser.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(chooser).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(async () => {
      const answer = await fetch(
        `${app.base}/api/projects/${project.id}/history?path=figures/wide.png`,
        { headers: { "x-nexttex-token": app.token } },
      );
      return ((await answer.json()).versions ?? []).length;
    }, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  await row.hover();
  await row.getByLabel("Actions for wide.png").click();
  await tab.getByTestId("file-menu").getByRole("button", { name: "History", exact: true }).click();
  const older = tab.getByTestId("version").last();
  await expect(older).toBeVisible({ timeout: 15_000 });
  await older.click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
  waiting = tab.waitForEvent("download");
  await tab.getByRole("button", { name: "Download", exact: true }).first().click();
  download = await waiting;
  expect(download.suggestedFilename()).toBe("wide.png");
  expect((await bytesOf(download)).equals(expected)).toBe(true);
});
