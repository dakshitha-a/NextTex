import { expect, type Page } from "@playwright/test";
import type { Instance } from "./server";

/** Waiting for typing to land, now that there is no save to wait for.
 *
 *  These tests used to wait for a `PUT /file`: the editor debounced a
 *  quarter of a second and then sent the whole file, so the response was a
 *  reliable "it is on disk now".  There is no such request any more.  A
 *  keystroke goes into the shared document over a WebSocket and the server
 *  writes the file from there, so what a test can wait for is the outcome
 *  rather than the mechanism -- which is the better thing to assert anyway.
 */

/** Poll the file until it says what it should. */
export async function landed(
  app: Instance,
  project: { id: string },
  contains: string,
  path = "main.tex",
  timeout = 15_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${app.base}/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`,
          { headers: { "x-nexttex-token": app.token } },
        );
        if (!response.ok) return "";
        return (await response.json()).text as string;
      },
      { timeout, message: `waiting for ${path} to contain ${contains}` },
    )
    .toContain(contains);
}

/** Replace the file's whole text, and wait until disk agrees. */
export async function retype(
  page: Page,
  app: Instance,
  project: { id: string },
  text: string,
): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await landed(app, project, text);
}
