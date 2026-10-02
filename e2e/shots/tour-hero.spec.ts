import { Recorder, glide } from "./recorder";
import {
  FRAMES, animate, atRest, caretToEndOf, dress, expect, filmedAt, line, onPage, span, test,
} from "./tour-kit";

/** The README's hero, "The page follows your typing", in both themes.
 *
 *  Its own file because it is filmed at three times the window's pixels
 *  and the tour's rows at two, and that is set per worker: the hero is
 *  shown at the README's full width and its close-up of the typeset page
 *  comes in more than four times, where the page's type is small, so it
 *  is cut from the most pixels.  Three times costs frames a second, about
 *  ten a second against sixteen at two, so the typing here is slower than
 *  in the rows, which keeps a frame to each keystroke or two. */

test.use(filmedAt(Number(process.env.NEXTTEX_SHOT_DPR ?? 3)));

// --- A: the page follows your typing --------------------------------------

for (const theme of ["light", "dark"] as const) {
  test(`A, the page follows your typing, ${theme}`, async ({ tab }) => {
    await dress(tab, theme);
    // A conversation in the column, as in the hero screenshot: the agent is
    // part of the picture of the app, though not of this scene's story.
    const composer = tab.locator("textarea");
    await composer.fill("#script:edit\nTighten the abstract's first sentence.");
    await tab.getByRole("button", { name: "Send" }).click();
    await tab.waitForTimeout(2500);
    await atRest(tab);
    await tab.mouse.move(700, 450);

    const rec = new Recorder(tab, `hero-${theme}`, FRAMES);
    await rec.start();
    await rec.hold(900);

    await caretToEndOf(tab, "conical intersection, a point");
    await rec.focus(await span(line(tab, "Molecules that absorb"), line(tab, "conical intersection, a point")), { pad: 70 });
    await rec.hold(700);
    await tab.keyboard.type(" We follow the wavepacket through it, femtosecond by femtosecond.", { delay: 85 });
    await rec.hold(300);

    // The page catches up, and the camera is already on it when it does.
    // It crosses to the typeset abstract, with room under it for the line
    // that is coming, while the build is still running; only the build's
    // wait is played fast, and the fast part ends when the build does,
    // before the page redraws, so the new sentence arrives up close at
    // real speed. Filmed the other way round, the camera reached the page
    // a moment after it had changed, and the change was never seen.
    const abstract = await span(onPage(tab, "Abstract"), onPage(tab, "Molecules"), onPage(tab, "meet."));
    await rec.focus({ ...abstract, height: abstract.height * 1.55 }, { pad: 22, zoom: 4.4, ease: 0.8 });
    await rec.hold(900);
    const status = tab.getByTestId("status");
    await rec.quickly(async () => {
      await expect(status).toHaveAttribute("data-state", /compiling|stale/, { timeout: 5_000 }).catch(() => undefined);
      await expect(status).toHaveAttribute("data-state", /built|ready/, { timeout: 45_000 });
    }, 2);
    await expect.poll(async () => onPage(tab, "femtosecond").count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await rec.hold(2800);

    // And back: a double-click on the page finds the line that set it.
    rec.wide();
    await rec.hold(900);
    const word = onPage(tab, "dollars");
    await glide(tab, word, 24);
    await rec.hold(300);
    await word.dblclick();
    await expect(tab.locator(".cm-activeLine")).toContainText("dollars", { timeout: 10_000 });
    await rec.focus(tab.locator(".cm-activeLine"), { pad: 90 });
    await rec.hold(1800);
    rec.wide();
    await rec.hold(1200);
    await rec.stop();
    animate(`hero-${theme}`, `hero-${theme}.webp`, ["--width", "1280"]);
  });
}
