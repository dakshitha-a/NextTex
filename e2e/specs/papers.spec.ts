import { test, expect } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Pointing at a folder of papers.
 *
 *  The pipeline itself is covered in Python; this is about the parts that
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
  // The panel is present, because this project has a bibliography and
  // there are two things to do to one whether or not a folder has ever
  // been read. What must not have happened is a read: no papers, and no
  // account of a run.
  await expect(tab.getByTestId("papers-panel")).toContainText("Papers (0)");
  await expect(tab.getByText(/not identified/)).toHaveCount(0);
});

test("a DOI on its own is enough, and the entries can be checked", async ({
  tab,
  page,
}) => {
  // R-084. The README calls working without an agent "a real option, not a
  // degraded one" and then describes two things that were agent tools and
  // nothing else. Both routes are answered here rather than let through:
  // they reach a publisher, and a browser test must not.
  await page.route("**/library/add", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        added: true,
        key: "LeCun2015deep",
        title: "Deep learning",
        author: "LeCun, Bengio, Hinton",
        year: "2015",
      }),
    }),
  );
  await page.route("**/library/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        checked: 3,
        problems: [{ key: "knuth1984", issues: ["year is 1986, not 1984"] }],
        report: "",
      }),
    }),
  );

  const panel = tab.getByTestId("papers-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await panel.getByRole("button", { name: /Papers/ }).click();

  await tab.getByTestId("papers-doi").fill("10.1038/nature14539");
  await tab.getByRole("button", { name: "Add", exact: true }).click();
  // What was added, so it can be checked against the page rather than
  // taken on trust.
  await expect(tab.getByTestId("papers-added")).toContainText("Deep learning");
  await expect(tab.getByTestId("papers-added")).toContainText("2015");

  await tab.getByTestId("papers-verify").click();
  await expect(tab.getByTestId("papers-report")).toContainText("knuth1984");
  await expect(tab.getByTestId("papers-report")).toContainText("1986");
});
