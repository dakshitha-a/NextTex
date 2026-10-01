import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** Closing figures' tabs leaves the source as it was.
 *
 *  The writer reported the source pane reading "offline" and, after a
 *  few figures were opened and their tabs closed until only main.tex was
 *  left, main.tex showing empty until it was clicked again in the tree.
 *  Closing the tab in front handed the next tab to the editor without
 *  asking what it was, so a figure was opened as text: its shared
 *  document was refused, over and over, which the pane reported as
 *  offline, and the open waited out its eight seconds and then put an
 *  empty document on screen over main.tex. */

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

test("closing three figures' tabs down to main.tex leaves main.tex whole and online", async ({
  tab, project,
}) => {
  test.setTimeout(90_000);
  const sockets: string[] = [];
  tab.on("websocket", (socket) => sockets.push(socket.url()));
  await expect(tab.locator(".cm-content")).toContainText("documentclass", { timeout: 30_000 });
  const before = (await tab.locator(".cm-content").innerText()).length;

  for (const name of ["a", "b", "c"]) writeFileSync(join(project.root, `${name}.png`), PNG);
  for (const name of ["a", "b", "c"]) {
    const row = tab.locator(`[role="tree"] [data-path="${name}.png"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(tab.getByTestId("file-view").locator("img")).toBeVisible({ timeout: 15_000 });
  }
  const textSockets = () => sockets.filter((url) => url.includes("/sync/text/")).length;
  const opened = textSockets();
  for (const name of ["c", "b", "a"]) {
    await tab.locator(`[data-tab][data-path="${name}.png"] > button`).nth(1).click();
  }
  await expect(tab.locator("[data-tab]")).toHaveCount(1);

  // No figure is handed to the editor, so no shared text is asked for.
  expect(textSockets()).toBe(opened);
  // Past the eight seconds an unanswered open used to wait before it put
  // an empty document on screen.
  await tab.waitForTimeout(9_000);
  const text = await tab.locator(".cm-content").innerText();
  expect(text.length).toBeGreaterThanOrEqual(before - 2);
  await expect(tab.getByText("offline", { exact: true })).toHaveCount(0);
});
