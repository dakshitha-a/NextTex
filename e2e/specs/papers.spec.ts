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

test("a folder's outcome reads as prose, and a PDF with no DOI is a row that can be given one", async ({
  tab,
}) => {
  // Two PDFs with nothing in them to find a DOI by: the scan runs, adds
  // nothing, and the drawer says so in words rather than as "2 not
  // identified", with a row per PDF and the one thing to do about it.
  const folder = join(tmpdir(), `nexttex-papers-${Date.now()}`);
  mkdirSync(join(folder, "scans"), { recursive: true });
  // Two different files: the scan folds identical bytes into one paper.
  writeFileSync(join(folder, "scans", "scan-2019-03.pdf"), "%PDF-1.4\n% scan");
  writeFileSync(join(folder, "scans", "preprint.pdf"), "%PDF-1.4\n% preprint");
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
  const chooser = tab.getByTestId("papers-chooser");
  await chooser.getByTestId("papers-path").fill(join(folder, "scans"));
  await tab.keyboard.press("Enter");
  await chooser.getByRole("button", { name: "Read 2 papers" }).click();

  await tab.getByTestId("bar-papers").click();
  const panel = tab.getByTestId("papers-panel");
  await expect(panel).toContainText("From the scans folder", { timeout: 30_000 });
  await expect(panel).toContainText("2 PDFs carry no DOI NextTex could find", { timeout: 30_000 });
  // One row per PDF, each with "Give a DOI" under the pointer (hidden at
  // rest, so counted by the element rather than by role).
  await expect(panel.locator("button", { hasText: "Give a DOI" })).toHaveCount(2);
  const preprint = panel.locator(".nx-row", { hasText: "preprint" });
  await preprint.hover();
  await expect(preprint.getByRole("button", { name: "Give a DOI" })).toBeVisible();
  await expect(panel).not.toContainText(/not identified|unidentified/);
  // Reading a folder is the heading's one button, as the page draws it;
  // the foot is the record check alone.
  await expect(panel).not.toContainText("Read a folder of PDFs");
  await tab.getByTestId("drawer").getByRole("button", { name: "Read a folder of PDFs" }).click();
  await expect(tab.getByTestId("papers-chooser")).toContainText("Add papers to references.bib");
  await tab.keyboard.press("Escape");
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

test("Escape closes the chooser without reading anything", async ({ tab, project }) => {
  // The template's bibliography holds one entry; emptied, so the drawer
  // has nothing to say but its one sentence.
  writeFileSync(join(project.root, "references.bib"), "");
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
  await expect(tab.getByTestId("papers-chooser")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("papers-chooser")).toHaveCount(0);
  // The drawer is there, because this project has a bibliography and
  // there are two things to do to one whether or not a folder has ever
  // been read. What must not have happened is a read: no papers, and no
  // account of a run.
  await tab.getByTestId("bar-papers").click();
  // Empty, the drawer is one sentence and the offer to read a folder; and
  // no account of a run, since none ran.
  await expect(tab.getByTestId("papers-panel")).toContainText("Nothing in the bibliography yet");
  await expect(tab.getByTestId("papers-panel")).not.toContainText("added");
  // With entries somebody typed, the sentence would be untrue, so the
  // drawer says what the file holds instead.
  writeFileSync(join(project.root, "references.bib"), "@book{knuth1984,\n  title = {The TeXbook},\n}\n");
  await tab.getByTestId("bar-files").click();
  await tab.getByTestId("bar-papers").click();
  await expect(tab.getByTestId("papers-panel")).toContainText("references.bib holds 1 entry.");
  await expect(tab.getByTestId("papers-panel")).not.toContainText("Nothing in the bibliography yet");
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
  // A pasted DOI goes through the one field: the server resolves it to a
  // row, and the row's Add is the same Add a search result has.
  await page.route("**/library/search?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "doi",
        results: [{
          doi: "10.1038/nature14539", title: "Deep learning", first: "LeCun", authors: 3,
          year: "2015", journal: "Nature", names: ["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
          abstract: "Deep learning allows computational models that are composed of multiple processing layers to learn representations of data.",
        }],
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

  await tab.getByTestId("bar-papers").click();
  const panel = tab.getByTestId("papers-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });

  await tab.getByTestId("papers-search").fill("10.1038/nature14539");
  await tab.keyboard.press("Enter");
  const row = tab.getByTestId("papers-result").first();
  await expect(row).toContainText("Deep learning");
  await expect(row).toContainText("LeCun et al., 2015, Nature");
  // The hover card carries what the row has no room for: every author,
  // the DOI in the mono, and the abstract.
  await row.hover();
  const card = tab.getByTestId("papers-card");
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText("Yann LeCun, Yoshua Bengio, Geoffrey Hinton");
  await expect(card).toContainText("10.1038/nature14539");
  await expect(card).toContainText("Deep learning allows");
  await row.getByTestId("papers-result-add").click();
  // What it was added as, beside the row, so the key can be typed at once.
  await expect(row.getByTestId("papers-result-added")).toHaveText("added as LeCun2015deep");

  await tab.getByTestId("papers-verify").click();
  await expect(tab.getByTestId("papers-report")).toContainText("knuth1984");
  await expect(tab.getByTestId("papers-report")).toContainText("1986");
});

test("the literature can be searched without an agent, and a result added by its DOI", async ({
  tab, page,
}) => {
  /* The agent has had this search since its literature tool landed; the
     writer without an agent did not.  Both routes are answered here: they
     reach a publisher, and a browser test must not. */
  const asked: string[] = [];
  await page.route("**/library/search?*", (route) => {
    asked.push(new URL(route.request().url()).search);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "openalex",
        results: [
          { doi: "10.1038/nature14539", title: "Deep learning", first: "LeCun", authors: 3, year: "2015", journal: "Nature" },
          { doi: "", title: "A record with no DOI", first: "Nobody", authors: 1, year: "", journal: "" },
        ],
      }),
    });
  });
  await page.route("**/library/add", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ added: true, key: "LeCun2015deep", title: "Deep learning", author: "LeCun", year: "2015" }),
    }),
  );

  await tab.getByTestId("bar-papers").click();
  const panel = tab.getByTestId("papers-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  // The publisher chooser appears once there is something to ask.
  await expect(tab.getByTestId("papers-source")).toHaveCount(0);
  await tab.getByTestId("papers-search").fill("deep learning");
  await tab.getByTestId("papers-source").selectOption("openalex");
  await tab.getByTestId("papers-search").press("Enter");

  const rows = tab.getByTestId("papers-result");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Deep learning");
  await expect(rows.nth(0)).toContainText("LeCun et al., 2015, Nature");
  await expect(rows.nth(1)).toContainText("no DOI");
  expect(asked[0]).toContain("q=deep%20learning");
  expect(asked[0]).toContain("source=openalex");

  await rows.nth(0).getByTestId("papers-result-add").click();
  await expect(rows.nth(0).getByTestId("papers-result-added")).toHaveText("added as LeCun2015deep");
});

test("the drawer says nothing about the bibliography until it knows", async ({ tab }) => {
  // The writer: the "Read a folder of PDFs" button "appears for a
  // fraction of a second and flashes out".  The drawer's counts started at
  // zero and zero drew "Nothing in the bibliography yet" with its button
  // for the round trip, until the answer said the file holds an entry.
  // With the answer held back, neither state may show; when it lands, the
  // right one does, alone.
  await tab.route("**/api/projects/*/library", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await tab.getByTestId("bar-papers").click();
  const panel = tab.getByTestId("papers-panel");
  await expect(panel).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await expect(panel.getByRole("button", { name: "Read a folder of PDFs" })).toHaveCount(0);
    await expect(panel).not.toContainText("Nothing in the bibliography yet");
    await expect(panel).not.toContainText("holds");
    await tab.waitForTimeout(100);
  }
  await expect(panel).toContainText("references.bib holds 1 entry.", { timeout: 5_000 });
  await expect(panel).not.toContainText("Nothing in the bibliography yet");
});
