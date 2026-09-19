import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { test, expect } from "../fixtures";

/** Before you submit: the rail panel that reads the last build and the
 *  sources and lists what a venue would send back.
 *
 *  The document has one of everything the check looks for: a `\today`,
 *  a TODO comment, a `\todo`, a duplicate label, an unused label, an
 *  uncited entry, a commented-out paragraph and a figure at 75 ppi.  The
 *  panel is asked after a real build, and each kind of row is asserted
 *  once; the `\today` row moves the caret, the image row turns the page,
 *  and the two venue facts change the list without a rebuild.
 */

/** A flat PNG, written by hand so the spec needs no image library. */
function png(width: number, height: number): Buffer {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf: Buffer) => {
    let c = -1;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.concat([Buffer.from(kind, "ascii"), body]);
    const out = Buffer.alloc(4);
    out.writeUInt32BE(body.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(head));
    return Buffer.concat([out, head, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SOURCE = [
  "\\documentclass{article}",
  "\\usepackage{graphicx}",
  "\\newcommand{\\todo}[1]{[#1]}",
  "\\author{Ada Lovelace}",
  "\\begin{document}",
  "Built on \\today.",
  "\\section{One}\\label{sec:one}",
  "\\section{Two}\\label{sec:one}",
  "\\section{Three}\\label{sec:three}",
  "See section \\ref{sec:one} and \\cite{knuth84}. % TODO check this",
  "\\todo{tighten}",
  "% This paragraph was taken out of the introduction and kept here in case",
  "% it is wanted again later, which is what a writer does while writing and",
  "% forgets to clean up before the paper goes out to the venue for review.",
  "\\newpage",
  "\\includegraphics[width=4in]{figures/low.png}",
  "\\bibliographystyle{plain}",
  "\\bibliography{references}",
  "\\end{document}",
  "",
].join("\n");

const BIB = [
  "@article{knuth84,",
  "  author = {Donald Knuth}, title = {Literate programming},",
  "  journal = {The Computer Journal}, year = {1984}",
  "}",
  "@book{lamport94,",
  "  author = {Leslie Lamport}, title = {LaTeX}, publisher = {Addison-Wesley}, year = {1994}",
  "}",
  "",
].join("\n");

test("the panel lists what a venue would send back, and every row that has a place goes there", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "figures", "low.png"), png(300, 200));
  const put = (path: string, text: string) =>
    fetch(`${app.base}/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path, text, compile: false, create: true }),
    });
  await put("references.bib", BIB);
  await put("main.tex", SOURCE);
  const build = await fetch(`${app.base}/api/projects/${project.id}/compile`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ full: true }),
  }).then((r) => r.json());
  expect(build.outcome).toBe("ok");

  const panel = tab.getByTestId("submit-panel");
  await panel.getByRole("button", { name: /Before you submit/ }).click();
  await panel.getByTestId("submit-check").click();
  await expect(panel.getByTestId("submit-headline")).toContainText(/2 pages, built .* with pdflatex/, {
    timeout: 30_000,
  });

  const rows = panel.getByTestId("submit-row");
  const row = (kind: string) => panel.locator(`[data-testid="submit-row"][data-kind="${kind}"]`).first();
  const kinds = async () =>
    new Set(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind"))));
  const found = await kinds();
  for (const kind of ["today", "todo", "duplicate-label", "unused-label", "uncited", "commented", "image"]) {
    expect(found, kind).toContain(kind);
  }
  expect(found).not.toContain("blind");
  expect(found).not.toContain("font");
  // The header counts what it found and how many are errors.
  await expect(panel.getByRole("button", { name: /Before you submit · \d+ \(\d+ to fix\)/ })).toBeVisible();

  // The `\today` row moves the caret to its line.
  await row("today").click();
  await expect(tab.getByTestId("caret")).toHaveText(/^Ln 6, /);
  // The image row has no line; it turns the page.
  const pageBox = tab.getByTestId("page-number");
  await expect.poll(async () => Number(await pageBox.getAttribute("max")), { timeout: 45_000 })
    .toBe(2);
  await row("image").click();
  await expect(pageBox).toHaveValue("2", { timeout: 20_000 });
  // A row opens to say what to do.
  await expect(row("image")).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("What to do:")).toBeVisible();

  // Blind review makes the author line a row, without a rebuild.
  await panel.getByTestId("submit-blind").click();
  await expect.poll(kinds, { timeout: 15_000 }).toContain("blind");
  await row("blind").click();
  await expect(tab.getByTestId("caret")).toHaveText(/^Ln 4, /);

  // A page limit under the count is a row; clearing it takes the row away.
  await panel.getByTestId("submit-page-limit").fill("1");
  await panel.getByTestId("submit-page-limit").press("Enter");
  await expect.poll(kinds, { timeout: 15_000 }).toContain("pages");
  await expect(panel.getByText("2 pages against a limit of 1")).toBeVisible();
  await panel.getByTestId("submit-page-limit").fill("");
  await panel.getByTestId("submit-page-limit").press("Enter");
  await expect.poll(kinds, { timeout: 15_000 }).not.toContain("pages");

  // Copy all puts one line per row on the clipboard, with its place first.
  await tab.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByTestId("submit-copy-all").click();
  const copied = await tab.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("main.tex:6: \\today");
  expect(copied).toContain("page 2: ");
});
