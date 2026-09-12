/** Ctrl+Z reaches this keyboard's own typing, and nothing else.
 *
 *  A buffer is built from the shared document before its socket has
 *  synced, so a file nobody else has open arrives in one remote
 *  transaction after the editor exists.  While CodeMirror's own history
 *  was in a live editor's extensions, that transaction was on its undo
 *  stack: six presses emptied the file, on disk, for everyone in the
 *  share.  Nobody had typed anything.
 *
 *  The tests below are the two halves of the answer.  Undo must not reach
 *  what the writer did not do, and must still reach what they did.  The
 *  keymap wiring is held by `frontend/src/panes/editor-undo.test.ts`; this
 *  is the disk, which is what was actually lost.
 */
import { test, expect } from "../fixtures";
import { landed } from "../typing";

async function onDisk(app: { base: string; token: string }, id: string) {
  const response = await fetch(
    `${app.base}/api/projects/${id}/file?path=main.tex`,
    { headers: { "x-nexttex-token": app.token } },
  );
  return (await response.json()).text as string;
}

async function pressUndo(tab: import("@playwright/test").Page, times: number) {
  await tab.locator(".cm-content").click();
  for (let press = 0; press < times; press += 1) {
    await tab.keyboard.press("Control+z");
    await tab.waitForTimeout(120);
  }
  // Longer than the settle the shared document writes on, so a write that
  // was going to happen has happened before the file is read.
  await tab.waitForTimeout(2000);
}

test("undo on a file nobody has typed in changes nothing", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });
  const before = await onDisk(app, project.id);
  expect(before).toContain("\\documentclass");

  await pressUndo(tab, 6);

  expect(await onDisk(app, project.id)).toBe(before);
});

test("undo takes back your own typing, and stops there", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });
  const before = await onDisk(app, project.id);

  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Home");
  await tab.keyboard.type("% a note to myself\n");
  await landed(app, project, "% a note to myself");

  // More presses than there were keystrokes: the extra ones must find
  // nothing of the writer's left to take back, and must not start on the
  // document that arrived from the socket.
  await pressUndo(tab, 12);

  const after = await onDisk(app, project.id);
  expect(after).not.toContain("% a note to myself");
  expect(after).toBe(before);
});
