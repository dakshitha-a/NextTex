import { test, expect, openProject } from "../fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** An audit of the text layer over the typeset page: drag selection into
 *  the gaps, what a copy puts on the clipboard, what a zoom costs, and the
 *  selection's look. Not a check: it prints what it finds. */
const OUT = process.env.SHOTS ?? "/tmp";
const BENCH = join(new URL(".", import.meta.url).pathname, "..", "..", "bench", "inverse-search", "docs");

test("the text layer, audited", async ({ app, project, page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  writeFileSync(join(project.root, "main.tex"), readFileSync(join(BENCH, "stress.tex")));
  writeFileSync(join(project.root, "chapter.tex"), readFileSync(join(BENCH, "chapter.tex")));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "Efficient" }).first()).toBeAttached({ timeout: 90_000 });

  const wordBox = (phrase: string) => page.evaluate((phrase) => {
    for (const span of document.querySelectorAll(".nx-text-layer span")) {
      const t = span.textContent ?? "";
      const i = t.indexOf(phrase);
      if (i < 0 || !span.firstChild) continue;
      span.scrollIntoView({ block: "center" });
      const r = document.createRange();
      r.setStart(span.firstChild, i); r.setEnd(span.firstChild, i + phrase.length);
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    return null;
  }, phrase);

  // 1. A drag from a word down into the gap under the paragraph.
  const start = (await wordBox("The model predicts"))!;
  await page.mouse.move(start.x + 2, start.y + start.h / 2);
  await page.mouse.down();
  const steps: string[] = [];
  for (const dy of [10, 30, 60, 90, 120]) {
    await page.mouse.move(start.x + 200, start.y + dy, { steps: 4 });
    steps.push(`${dy}px: ${String(await page.evaluate(() => String(window.getSelection()).length))} chars`);
  }
  // Into the right margin, beside the paragraph's lines.
  const box = await page.locator(".nx-page").first().boundingBox();
  await page.mouse.move(box!.x + box!.width - 10, start.y + 30, { steps: 4 });
  steps.push(`margin: ${await page.evaluate(() => String(window.getSelection()).length)} chars`);
  await page.mouse.up();
  console.log("DRAG", steps.join(" | "));
  await page.screenshot({ path: `${OUT}/drag.png` });

  // 2. What a copy carries: ligatures, a spacing accent, a hyphen at a
  // line end.
  const copyOf = async (from: string, to: string) => {
    await page.evaluate(({ from, to }) => {
      const spans = [...document.querySelectorAll(".nx-text-layer span")];
      const a = spans.find((s) => (s.textContent ?? "").includes(from))!;
      const b = spans.find((s) => (s.textContent ?? "").includes(to))!;
      const r = document.createRange();
      r.setStart(a.firstChild!, (a.textContent ?? "").indexOf(from));
      r.setEnd(b.firstChild!, (b.textContent ?? "").indexOf(to) + to.length);
      const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
    }, { from, to });
    await page.keyboard.press("Control+c");
    return page.evaluate(() => navigator.clipboard.readText());
  };
  console.log("COPY1", JSON.stringify(await copyOf("Efficient", "waffles")));
  console.log("COPY2", JSON.stringify(await copyOf("odinger wrote", "readers agree")));
  console.log("COPY3", JSON.stringify(await copyOf("exceedingly", "electrochemically")));

  // 3. What a zoom costs: the time from the zoom to a rebuilt layer.
  const t0 = Date.now();
  const before = await page.locator(".nx-text-layer span").count();
  await page.evaluate(() => (window as any).__spanMark = document.querySelector(".nx-text-layer span"));
  const done = page.evaluate(() => new Promise<number>((resolve) => {
    const started = performance.now();
    const mark = (window as any).__spanMark as Element;
    const check = () => (mark.isConnected ? requestAnimationFrame(check) : resolve(performance.now() - started));
    requestAnimationFrame(check);
  }));
  await page.getByRole("button", { name: "Zoom in" }).click();
  const replaced = await Promise.race([done.then(() => true), page.waitForTimeout(3000).then(() => false)]);
  console.log("ZOOMIN", replaced ? "the first page's spans were replaced" : "the first page's spans were kept and rescaled");
  console.log("SCALE", await page.evaluate(() => getComputedStyle(document.querySelector(".nx-text-layer span")!).fontSize));
  void t0; void before;

  // 4. The selection's look, on text, maths and a figure, after the zoom.
  await page.waitForTimeout(1500);
  await copyOf("The ground state", "holds");
  const pg = (await wordBox("The ground state"))!;
  await page.screenshot({ path: `${OUT}/sel-dark.png`, clip: { x: pg.x - 20, y: pg.y - 20, width: 760, height: 120 } });
});
