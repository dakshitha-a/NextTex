import { test, expect } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Pointing at a folder of papers.
 *
 *  The pipeline itself is covered in Python — this is about the parts that
 *  only exist in a browser: that the item is on the .bib file's menu and
 *  nowhere else, that the chooser browses the *server's* filesystem, and
 *  that a folder with nothing in it cannot be read by accident.
 */

test("only a .bib file offers to be filled from a folder", async ({ tab }) => {
  await tab.getByLabel("Actions for main.tex").click();
  await expect(
    tab.getByRole("button", { name: /Add papers from a folder/ }),
  ).toHaveCount(0);
  await tab.keyboard.press("Escape");

  await tab.getByLabel("Actions for references.bib").click();
  await expect(
    tab.getByRole("button", { name: /Add papers from a folder/ }),
  ).toBeVisible();
});

test("the chooser browses the machine running NextTex", async ({ tab }) => {
  const folder = join(tmpdir(), `nexttex-papers-${Date.now()}`);
  mkdirSync(join(folder, "collection"), { recursive: true });
  writeFileSync(join(folder, "collection", "one.pdf"), "%PDF-1.4");
  writeFileSync(join(folder, "collection", "two.pdf"), "%PDF-1.4");

  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();

  const chooser = tab.getByTestId("papers-chooser");
  await expect(chooser).toBeVisible();
  await expect(chooser).toContainText("Add papers to references.bib");

  // Typed, because pasting a path somebody sent you is the fastest route
  // into a deep Zotero folder.
  await chooser.getByTestId("papers-path").fill(folder);
  await tab.keyboard.press("Enter");
  await expect(chooser.getByRole("button", { name: /collection/ })).toBeVisible({
    timeout: 10_000,
  });

  // The count is of the whole tree, not just this folder: in a Zotero
  // storage/ tree every subfolder holds one paper and a shallow count
  // would say nothing is here.
  await expect(chooser.getByTestId("papers-count")).toContainText("2 PDFs");
  await expect(
    chooser.getByRole("button", { name: "Read 2 papers" }),
  ).toBeEnabled();
});

test("a folder with no papers cannot be read by accident", async ({ tab }) => {
  const empty = join(tmpdir(), `nexttex-empty-${Date.now()}`);
  mkdirSync(empty, { recursive: true });

  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
  const chooser = tab.getByTestId("papers-chooser");
  await chooser.getByTestId("papers-path").fill(empty);
  await tab.keyboard.press("Enter");

  await expect(chooser.getByTestId("papers-count")).toContainText("No PDFs here.");
  await expect(chooser.getByRole("button", { name: /^Read/ })).toBeDisabled();
});

test("a folder that is not there says so, in place", async ({ tab }) => {
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
  const chooser = tab.getByTestId("papers-chooser");
  await chooser.getByTestId("papers-path").fill("/definitely/not/here");
  await tab.keyboard.press("Enter");
  await expect(chooser.getByText("There is no folder at that path.")).toBeVisible();
});

test("Escape closes the chooser without reading anything", async ({ tab }) => {
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
  await expect(tab.getByTestId("papers-chooser")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("papers-chooser")).toHaveCount(0);
  await expect(tab.getByTestId("papers-panel")).toHaveCount(0);
});
