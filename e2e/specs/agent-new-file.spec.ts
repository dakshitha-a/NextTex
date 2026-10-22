import { test, expect } from "../fixtures";

/** A file the agent creates opens in the editor with what it wrote.
 *
 *  Reported from the resume project on 21 October 2026: the agent wrote a
 *  new resume and cover letter, and the editor showed one of them as an
 *  empty page until the browser tab was reloaded. The agent says where it
 *  is about to write and then that it wrote, and the editor opens the file
 *  for each. For a file that does not exist yet, both opens wait for the
 *  manifest to name it. Over a network, the manifest's update reaches the
 *  page after the second announcement, so both woke together, each built a
 *  document of its own, and the first, overtaken, destroyed the second's.
 *
 *  The browser here sits beside the server, where the update always won
 *  that race, so every socket's traffic is delayed by 80 ms in each
 *  direction, about what the writer's laptop sees over Tailscale. The
 *  agent writes the way the real one does: the file reaches the disk
 *  first, and NextTex hears about it from the hook a moment later.
 */

test.setTimeout(60_000);

test("a file the agent creates opens with its text, over a slow link", async ({ tab }) => {
  await tab.addInitScript(() => {
    const Real = window.WebSocket;
    const DELAY = 80;
    class Slow extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        // In order, each one 80 ms after it was sent or received.
        let last = 0;
        const later = (fn: () => void) => {
          const at = Math.max(Date.now() + DELAY, last + 1);
          last = at;
          setTimeout(fn, at - Date.now());
        };
        const send = this.send.bind(this);
        this.send = (data: any) => later(() => {
          if (this.readyState === Real.OPEN) send(data);
        });
        let handler: ((event: MessageEvent) => void) | null = null;
        super.onmessage = (event: MessageEvent) => later(() => handler?.call(this, event));
        Object.defineProperty(this, "onmessage", {
          get: () => handler,
          set: (fn) => { handler = fn; },
        });
      }
    }
    (window as any).WebSocket = Slow;
  });
  await tab.reload();
  await expect(tab.locator(".cm-content")).toContainText("A document to start writing in", {
    timeout: 15_000,
  });

  const composer = tab.locator("textarea");
  await composer.click();
  await composer.fill("#script:newfiles\nWrite a resume and a letter.");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText("Both are written.")).toBeVisible({ timeout: 20_000 });

  // The letter, written last, is in front, and it is the letter rather
  // than the file that was there before: the editor stayed on main.tex
  // while both opens hung, and after eight seconds showed an empty page.
  const editor = tab.locator(".cm-content");
  await expect(editor).toContainText("Line 39 of the letter.", { timeout: 6_000 });
  await tab.waitForTimeout(9_000);
  await expect(editor).toContainText("Line 39 of the letter.");

  // And the resume, behind it, comes back with its text.
  await tab.locator('[data-tab][data-path="jobs/resume.tex"]').click();
  await expect(editor).toContainText("Line 39 of the resume.", { timeout: 6_000 });
});
