import type { CDPSession, Locator, Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Frames for the README's animations, and where the camera should look.
 *
 *  The browser is filmed through the DevTools screencast, which sends a
 *  frame each time the page repaints, with the time it painted, so a
 *  scene that sits still costs nothing and one that types costs a frame a
 *  keystroke.  Every frame is the whole viewport at full resolution; the
 *  zooming is not done here.  The scene says what matters and when, with
 *  `focus` and `wide`, and `e2e/shots/animate.py` turns those marks into a
 *  camera that glides between them, cropping the full frames, so a zoomed
 *  view is as sharp as the screen was and never an enlarged thumbnail.
 *
 *  Headless Chromium draws no mouse pointer, and an animation where things are
 *  clicked by nobody is hard to follow, so `install` puts a drawn pointer
 *  on the page that follows the real one and pulses on a click. */

type Rect = { x: number; y: number; width: number; height: number };
type Mark = { t: number; kind: "focus" | "wide"; rect?: Rect; ease: number };
type Fast = { from: number; to: number; speed: number };

const POINTER = `
(() => {
  if (window.__nxPointer) return;
  window.__nxPointer = true;
  const start = () => {
    const dot = document.createElement("div");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 40ms linear";
    dot.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8.2-6.3 1.3 3.6 7.1-2.6 1.3-3.6-7.2L3 17z" fill="#fff" stroke="#1b1f1d" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2.5px solid #b06fd6;z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.4)";
    document.documentElement.append(ring, dot);
    let x = -100, y = -100;
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; dot.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)"; }, true);
    addEventListener("mousedown", () => {
      ring.style.left = x + "px"; ring.style.top = y + "px";
      ring.animate([{ opacity: .9, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.3)" }], { duration: 420, easing: "ease-out" });
    }, true);
  };
  if (document.documentElement) start(); else addEventListener("DOMContentLoaded", start);
})();`;

export class Recorder {
  private session: CDPSession | null = null;
  private frames: { t: number; file: string }[] = [];
  private marks: Mark[] = [];
  private fast: Fast[] = [];
  private t0 = 0;
  private dir = "";
  private count = 0;

  constructor(private page: Page, private name: string, private root: string) {}

  /** The drawn pointer, on this page and on every page it loads next. */
  static async install(page: Page): Promise<void> {
    await page.addInitScript(POINTER);
    await page.evaluate(POINTER);
  }

  async start(): Promise<void> {
    this.dir = join(this.root, this.name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    const viewport = this.page.viewportSize()!;
    const scale = await this.page.evaluate(() => window.devicePixelRatio);
    this.session = await this.page.context().newCDPSession(this.page);
    this.t0 = Date.now() / 1000;
    this.session.on("Page.screencastFrame", async (frame) => {
      const file = `f${String(this.count++).padStart(5, "0")}.png`;
      writeFileSync(join(this.dir, file), Buffer.from(frame.data, "base64"));
      const t = (frame.metadata.timestamp ?? Date.now() / 1000) - this.t0;
      this.frames.push({ t, file });
      await this.session?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await this.session.send("Page.startScreencast", {
      format: "png",
      maxWidth: Math.round(viewport.width * scale),
      maxHeight: Math.round(viewport.height * scale),
      everyNthFrame: 1,
    });
    // A repaint to be sure the first frame is the opening one.
    await this.page.evaluate(() => document.body.style.setProperty("--nx-rec", "1"));
    await this.page.waitForTimeout(250);
  }

  private now(): number {
    return Date.now() / 1000 - this.t0;
  }

  /** Glide the camera to this element, padded, over `ease` seconds. */
  async focus(target: Locator | Rect, opts: { pad?: number; ease?: number } = {}): Promise<void> {
    const box = "x" in target ? target : await target.boundingBox();
    if (!box) throw new Error(`${this.name}: nothing to focus on`);
    const pad = opts.pad ?? 40;
    this.marks.push({
      t: this.now(),
      kind: "focus",
      rect: { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad },
      ease: opts.ease ?? 0.7,
    });
  }

  /** Pull back to the whole window. */
  wide(ease = 0.7): void {
    this.marks.push({ t: this.now(), kind: "wide", ease });
  }

  /** Wait for something slow, a build or a search, and play the wait
   *  back faster, so the animation spends its seconds on what happens rather
   *  than on the wait for it. */
  async quickly<T>(wait: () => Promise<T>, speed = 5): Promise<T> {
    const from = this.now();
    const result = await wait();
    this.fast.push({ from, to: this.now(), speed });
    return result;
  }

  async hold(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async stop(): Promise<void> {
    await this.page.waitForTimeout(300);
    await this.session?.send("Page.stopScreencast").catch(() => undefined);
    await this.page.waitForTimeout(200);
    await this.session?.detach().catch(() => undefined);
    const viewport = this.page.viewportSize()!;
    writeFileSync(
      join(this.dir, "scene.json"),
      JSON.stringify({ name: this.name, viewport, end: this.now(), frames: this.frames, marks: this.marks, fast: this.fast }, null, 1),
    );
  }
}

/** Move the drawn pointer to an element the way a hand would, in steps. */
export async function glide(page: Page, target: Locator, steps = 18): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to point at");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  return { x, y };
}
