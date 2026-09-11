import { test, expect } from "../fixtures";
import { landed } from "../typing";

/** Can Ctrl+Z empty a file that was only ever read?
 *
 *  `yCollab` does not install `yUndoManagerKeymap`, and `editor-setup.ts`
 *  installs CodeMirror's own `history()` and `historyKeymap`, so Mod-z goes
 *  to CodeMirror rather than to the scoped `Y.UndoManager`.  The buffer is
 *  built from `opened.text.toString()` before the socket has synced, so the
 *  whole file arrives afterwards as a remote transaction that y-sync
 *  dispatches with `ySyncAnnotation` and no `addToHistory.of(false)`.
 *
 *  If CodeMirror's history recorded that, one undo removes the document. */
test("undo on a file nobody has typed in", async ({ app, project, tab }) => {
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await expect(tab.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });

  const read = async () => {
    const response = await fetch(
      `${app.base}/api/projects/${project.id}/file?path=main.tex`,
      { headers: { "x-nexttex-token": app.token } },
    );
    return (await response.json()).text as string;
  };

  const before = await read();
  console.log("ON DISK BEFORE:", before.length, "characters");

  await tab.locator(".cm-content").click();
  await tab.waitForTimeout(500);
  for (let i = 0; i < 6; i += 1) {
    await tab.keyboard.press("Control+z");
    await tab.waitForTimeout(250);
  }
  await tab.waitForTimeout(2500);

  const inEditor = (await tab.locator(".cm-content").innerText()).length;
  const after = await read();
  console.log("IN EDITOR AFTER SIX UNDOS:", inEditor, "characters");
  console.log("ON DISK AFTER:", after.length, "characters");
  await tab.screenshot({ path: "/tmp/review-shots/a3-undo-after.png" });
  if (after.length < before.length) {
    console.log("!! UNDO REMOVED", before.length - after.length, "CHARACTERS FROM DISK");
  }
});

test("undo past the start of your own typing", async ({ app, project, tab }) => {
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await expect(tab.locator(".cm-content")).toContainText("documentclass", {
    timeout: 30_000,
  });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("ZZZreviewmarkerZZZ");
  await landed(app, project, "ZZZreviewmarkerZZZ");

  const read = async () => {
    const response = await fetch(
      `${app.base}/api/projects/${project.id}/file?path=main.tex`,
      { headers: { "x-nexttex-token": app.token } },
    );
    return (await response.json()).text as string;
  };
  const before = (await read()).length;
  console.log("ON DISK AFTER TYPING:", before);

  for (let i = 0; i < 12; i += 1) {
    await tab.keyboard.press("Control+z");
    await tab.waitForTimeout(200);
  }
  await tab.waitForTimeout(2500);
  const after = await read();
  console.log("ON DISK AFTER TWELVE UNDOS:", after.length);
  console.log("STILL HAS documentclass:", after.includes("documentclass"));
});
