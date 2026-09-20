import { createServer } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { test, expect, openFolders } from "../fixtures";
import { startServer } from "../server";
import { png } from "../png";
import { zip } from "../zip";

/** Arrive with a project: the fourth tile on the projects rail.
 *
 *  A zip chosen with the button beside the field is unpacked into a new
 *  folder, with the entries that would run or leave the folder left out
 *  and named in a notice inside the project; an arXiv id is fetched from
 *  the e-print endpoint, which the spec stands in for with a tiny server
 *  the seam `NEXTTEX_ARXIV_BASE` points the app at, the way the install
 *  spec points it at a fake tlmgr.
 */

const BRING = "Bring one from elsewhere";

/** A tar with one file, gzipped: what arXiv sends for a one-file paper
 *  with its source in a tar.  Written by hand for the same reason the zip
 *  is: ustar headers are fixed-width fields and a checksum. */
function tarGz(name: string, body: string): Buffer {
  const bytes = Buffer.from(body, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000644\0", 100, "utf8");
  header.write("0000000\0", 108, "utf8");
  header.write("0000000\0", 116, "utf8");
  header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  header.write("00000000000\0", 136, "utf8");
  header.write("        ", 148, "utf8");
  header.write("0", 156, "utf8");
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
  const padded = Buffer.alloc(Math.ceil(bytes.length / 512) * 512);
  bytes.copy(padded);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

test("a zip becomes a project, with what was left out named inside it", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  // One filled button and three more behind the quiet menu.
  await expect(page.getByTestId("new-project")).toBeVisible();
  await page.getByTestId("ways-open").click();
  await expect(page.getByTestId("ways-menu").getByRole("menuitem")).toHaveCount(3);
  await page.getByTestId("ways-menu").getByRole("menuitem", { name: new RegExp(BRING) }).click();

  const archive = zip({
    "paper/main.tex": "\\documentclass{article}\n\\begin{document}\nArrived.\n\\end{document}\n",
    "paper/figures/a.png": png(40, 30),
    "paper/.claude/settings.json": "{}",
    "paper/../outside.tex": "no",
  });
  await page.getByTestId("bring-zip").setInputFiles({
    name: "paper.zip", mimeType: "application/zip", buffer: archive,
  });
  await expect(page.getByTestId("bring-source")).toHaveValue("paper.zip");
  const folder = join(app.projects, `brought-${Date.now()}`);
  await page.getByPlaceholder("Where to put it, e.g. ~/writing/their-paper").fill(folder);
  await page.getByRole("button", { name: "Bring it" }).click();

  // The project opens on its document, the figure is in the tree, and
  // the notice names what the archive carried and the project did not get.
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".cm-content")).toContainText("Arrived.");
  await openFolders(page, "figures/a.png");
  await expect(page.locator('[role="tree"] [data-path="figures/a.png"]')).toBeVisible();
  const notice = page.getByTestId("notices");
  await expect(notice).toContainText(".claude/settings.json");
  await expect(notice).toContainText("paper/../outside.tex");
  await expect(page.locator('[role="tree"] [data-path=".claude"]')).toHaveCount(0);
});

test("an arXiv id is fetched and unpacked into a new project", async ({ page }) => {
  // A stand-in for arxiv.org's e-print endpoint on a port of its own.
  const paper = tarGz("main.tex", "\\documentclass{article}\n\\begin{document}\nFrom arXiv.\n\\end{document}\n");
  const stub = createServer((request, response) => {
    if (request.url === "/e-print/2301.01234") {
      response.writeHead(200, { "content-type": "application/x-eprint-tar" });
      response.end(paper);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((ready) => stub.listen(0, "127.0.0.1", () => ready()));
  const port = (stub.address() as { port: number }).port;
  const app = await startServer({ NEXTTEX_ARXIV_BASE: `http://127.0.0.1:${port}` });
  try {
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: true }).waitFor();
    await page.getByTestId("ways-open").click();
  await page.getByTestId("ways-menu").getByRole("menuitem", { name: new RegExp(BRING) }).click();
    await page.getByTestId("bring-source").fill("https://arxiv.org/abs/2301.01234");
    const folder = join(app.projects, `arxiv-${Date.now()}`);
    await page.getByPlaceholder("Where to put it, e.g. ~/writing/their-paper").fill(folder);
    await page.getByRole("button", { name: "Bring it" }).click();
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".cm-content")).toContainText("From arXiv.");
  } finally {
    await app.stop();
    stub.close();
  }
});

test("something that is neither an id, a URL nor a zip is refused in the form", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await page.getByTestId("ways-open").click();
  await page.getByTestId("ways-menu").getByRole("menuitem", { name: new RegExp(BRING) }).click();
  await page.getByTestId("bring-source").fill("my thesis");
  await page.getByPlaceholder("Where to put it, e.g. ~/writing/their-paper").fill(join(app.projects, "nowhere"));
  await page.getByRole("button", { name: "Bring it" }).click();
  await expect(page.getByText("Type an arXiv id or a git URL, or choose a zip.")).toBeVisible();
});
