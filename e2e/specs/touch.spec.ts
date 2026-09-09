import { expect, test } from "../fixtures";

/** The tablet project: a real touch pointer, at a tablet's size and density.
 *
 *  Nothing is installed on a tablet.  The server stays on its own machine and
 *  a tablet is a browser reaching it over the tailnet, which is what the
 *  README already describes, so what is being tested here is whether this
 *  interface can be operated by a finger rather than whether it can be
 *  deployed to one.
 *
 *  Written after proving each mechanism on the smallest page that uses it,
 *  which is what `docs/testing.md` asks for after the drag episode: a browser
 *  feature that appears not to work under test is usually the harness.
 */

test("the controls that hide behind hover are visible without one", async ({
  tab,
}) => {
  // These were the worst of it and not because of their size.  A control at
  // `opacity-0` until `group-hover` is not small on a device that cannot
  // hover, it is absent: there is no gesture that reveals it.
  const menu = tab.getByRole("button", { name: /^Actions for/ }).first();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("opacity", "1");
});

test("the smallest controls answer a finger", async ({ tab }) => {
  // 44 on the axis with room, and the row's own pitch on the axis without.
  // A flat 44 here would reach into the rows above and below and take their
  // taps, which is a worse bug than a small target.
  const close = tab.getByRole("button", { name: /^Close / }).first();
  await expect(close).toBeVisible();
  const area = await close.evaluate((el) => {
    const after = getComputedStyle(el, "::after");
    return { width: parseFloat(after.width), height: parseFloat(after.height) };
  });
  expect(area.width).toBeGreaterThanOrEqual(44);
  // The tab strip is 26px tall, so that is the honest ceiling on this axis.
  expect(area.height).toBeGreaterThanOrEqual(26);
});

test("a pinch zooms the page the way the trackpad does", async ({ tab }) => {
  // Two fingers into the same path the wheel already feeds, so the limits,
  // the frame coalescing and the commit are all unchanged.  Driven through
  // real touch input rather than synthesised events, because the existing
  // pinch spec synthesises a wheel and that is exactly the shortcut that once
  // hid a real drag bug.
  const zoom = tab.getByTestId("zoom");
  await expect(zoom).toBeVisible({ timeout: 30_000 });
  const before = parseInt((await zoom.innerText()).replace("%", ""), 10);

  const page = tab.locator(".nx-page").first();
  const box = await page.boundingBox();
  expect(box).not.toBeNull();
  const midX = box!.x + box!.width / 2;
  const midY = box!.y + box!.height / 2;

  const session = await tab.context().newCDPSession(tab);
  const send = (type: string, spread: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [
              { x: midX - spread, y: midY, id: 1 },
              { x: midX + spread, y: midY, id: 2 },
            ],
    });

  await send("touchStart", 40);
  for (const spread of [60, 90, 130, 180]) {
    await send("touchMove", spread);
    await tab.waitForTimeout(30);
  }
  await send("touchEnd", 0);

  await expect
    .poll(async () => parseInt((await zoom.innerText()).replace("%", ""), 10), {
      timeout: 10_000,
    })
    .toBeGreaterThan(before);
});
