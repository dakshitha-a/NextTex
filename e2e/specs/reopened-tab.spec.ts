import { test, expect } from "../fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A file closed and opened again is connected again.
 *
 *  The second open was handed the first one's shared document, which
 *  closing the tab had destroyed along with its socket: the tab showed the
 *  text it had when it closed, an outside rewrite or the agent's edit
 *  never reached it, and what was typed into it reached nothing, while the
 *  connection indicator went on reading live.  Found on a checklist.md the
 *  agent kept rewriting; `frontend/src/collab.ts`, `build`.
 */

async function shown(tab: import("@playwright/test").Page): Promise<string> {
  return (await tab.locator(".cm-content").innerText()).replace(/\n/g, "|");
}

test("a tab closed and reopened takes outside edits and sends what is typed", async ({
  project, tab,
}) => {
  const sockets: string[] = [];
  tab.on("websocket", (socket) => sockets.push(socket.url()));
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const file = join(project.root, "checklist.md");
  writeFileSync(file, "# Checklist\n- first\n");
  await tab.getByText("checklist.md").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("first");

  await tab.locator('[data-tab][data-path="checklist.md"]').getByLabel("Close checklist.md").click();
  await expect(tab.locator('[data-tab][data-path="checklist.md"]')).toHaveCount(0);
  const texts = () => sockets.filter((url) => url.includes("/sync/text/")).length;
  const before = texts();

  await tab.getByText("checklist.md").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("first");
  // A socket of its own, rather than the closed one it used to be handed.
  await expect.poll(texts, { timeout: 15_000 })
    .toBeGreaterThan(before);

  writeFileSync(file, "# Checklist\n- rewritten outside\n");
  await expect.poll(() => shown(tab), { timeout: 15_000 }).toContain("rewritten outside");

  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("- typed after");
  await expect.poll(() => readFileSync(file, "utf-8"), { timeout: 15_000 }).toContain("- typed after");
});
