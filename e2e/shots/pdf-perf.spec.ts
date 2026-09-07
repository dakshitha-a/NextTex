import { test, expect } from "../fixtures";

/** How much layout work one pinch costs.
 *
 *  Not a pass/fail check -- it prints numbers.  A pinch arrives as a stream
 *  of wheel events at whatever rate the trackpad reports, and the question
 *  is how much of the frame each one spends forcing the browser to lay the
 *  document out again.  `LayoutCount` is the honest measure: one per frame
 *  is the floor, one per event means the gesture is thrashing.
 */
test("what a pinch costs", async ({ tab }) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(tab.getByTestId("zoom")).toBeVisible();
  const box = (await tab.locator("canvas").first().boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const cdp = await tab.context().newCDPSession(tab);
  await cdp.send("Performance.enable");
  const read = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const of = (name: string) =>
      metrics.find((m: { name: string }) => m.name === name)?.value ?? 0;
    return {
      layouts: of("LayoutCount"),
      styles: of("RecalcStyleCount"),
      layoutMs: of("LayoutDuration") * 1000,
      styleMs: of("RecalcStyleDuration") * 1000,
      scriptMs: of("ScriptDuration") * 1000,
    };
  };

  const before = await read();
  // Sixty events in bursts of three.  A trackpad reports a pinch at rather
  // more than the display refreshes -- two to four events per frame is the
  // ordinary case -- and pacing one event per frame would measure a gesture
  // nobody makes, while hiding whether the handler coalesces at all.
  const FRAMES = 20;
  const PER_FRAME = 3;
  const EVENTS = FRAMES * PER_FRAME;
  await tab.evaluate(
    async ({ at, frames, perFrame }) => {
      const target = document.elementFromPoint(at.x, at.y) ?? document.body;
      for (let f = 0; f < frames; f += 1) {
        for (let i = 0; i < perFrame; i += 1) {
          target.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: f % 6 === 5 ? 4 : -3,
              ctrlKey: true,
              clientX: at.x,
              clientY: at.y,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    },
    { at, frames: FRAMES, perFrame: PER_FRAME },
  );
  const after = await read();

  const d = (k: keyof typeof before) => after[k] - before[k];
  console.log(
    `\n  pinch of ${EVENTS} events in ${FRAMES} frames:\n` +
      `    layouts        ${d("layouts").toFixed(0)}  (${(d("layouts") / EVENTS).toFixed(2)} per event)\n` +
      `    style recalcs  ${d("styles").toFixed(0)}  (${(d("styles") / EVENTS).toFixed(2)} per event)\n` +
      `    layout time    ${d("layoutMs").toFixed(1)} ms\n` +
      `    style time     ${d("styleMs").toFixed(1)} ms\n` +
      `    script time    ${d("scriptMs").toFixed(1)} ms\n`,
  );
});
