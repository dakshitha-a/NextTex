import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** Every kind a writer keeps beside a manuscript lands in the tree.
 *
 *  The drop and the upload route never filtered by type, only refusing
 *  the files a build would run, but nothing had dropped anything but a
 *  PNG. So one of each: Word, Excel, PowerPoint, PDF, Markdown, Python,
 *  and pictures in the formats they arrive in, onto the tree and onto a
 *  folder, each found as a row and on disk with its bytes intact.
 */

const KINDS: [string, string][] = [
  ["reviewer-notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["lifetimes.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["group-meeting.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["schuurman2018.pdf", "application/pdf"],
  ["plan.md", ""],
  ["fit.py", "text/x-python"],
  ["decay.png", "image/png"],
  ["photo.jpg", "image/jpeg"],
  ["spinner.gif", "image/gif"],
  ["shot.webp", "image/webp"],
  ["scheme.svg", "image/svg+xml"],
];
const INTO_FOLDER: [string, string][] = [
  ["microscope-scan.tif", "image/tiff"],
  ["phone-photo.heic", "image/heic"],
];

async function dropOn(tab: import("@playwright/test").Page, selector: string, files: [string, string][]) {
  const data = await tab.evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const [name, type] of list) transfer.items.add(new File([`bytes of ${name}`], name, { type }));
    return transfer;
  }, files);
  await tab.dispatchEvent(selector, "drop", { dataTransfer: data });
}

test("documents, code and pictures of every usual kind land in the tree and on disk", async ({
  tab, project,
}) => {
  const tree = tab.getByRole("tree");
  await expect(tree).toBeVisible({ timeout: 20_000 });

  await dropOn(tab, "[role=tree]", KINDS);
  for (const [name] of KINDS) {
    await expect(tree.getByRole("treeitem", { name: new RegExp(name.replace(".", "\\.")) }).first())
      .toBeVisible({ timeout: 15_000 });
    expect(readFileSync(join(project.root, name), "utf-8")).toBe(`bytes of ${name}`);
  }

  // Onto a folder: the folder is the destination, and nothing is asked.
  await dropOn(tab, "[data-path='figures']", INTO_FOLDER);
  for (const [name] of INTO_FOLDER) {
    await expect.poll(() => existsSync(join(project.root, "figures", name)), { timeout: 15_000 }).toBe(true);
  }
  await expect(tab.getByRole("dialog")).toHaveCount(0);
  await expect(tab.getByText(/refused|did not arrive/i)).toHaveCount(0);
});
