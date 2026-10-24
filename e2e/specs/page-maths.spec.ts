import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** A published page sets its maths with the KaTeX NextTex serves.
 *
 *  The page's sandbox gives it an origin of its own, so its policy has to
 *  name the server's KaTeX folder and the folder has to answer a font's
 *  CORS request; either missing, and the maths fell back to the system's
 *  serif or did not set at all. The tags are the ones `{{maths}}` fills
 *  in (`nexttex/page_parts.py`), with a favicon from the set. */

const TAGS =
  '<link rel="stylesheet" href="/assets/katex/katex.min.css">' +
  '<script src="/assets/katex/katex.min.js"></script>' +
  '<script src="/assets/katex/contrib/auto-render.min.js"></script>' +
  '<script src="/assets/katex/contrib/mhchem.min.js"></script>' +
  "<script>renderMathInElement(document.body,{delimiters:[{left:'$',right:'$',display:false}],macros:{'\\\\Ham':'\\\\hat{H}'}});</script>";

test("a published page sets its maths, with KaTeX's fonts and the project's macros", async ({ app, project, page }) => {
  const pages = join(project.root, ".nexttex", "pages");
  mkdirSync(pages, { recursive: true });
  writeFileSync(
    join(pages, "derivation.html"),
    '<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22/%3E"><title>Derivation</title></head>' +
      `<body><p id="eq">$\\Ham\\Psi = E\\Psi$ and $\\ce{H2O}$</p>${TAGS}</body></html>`,
  );
  const refused: string[] = [];
  page.on("console", (message) => {
      if (/Refused|blocked by CORS/.test(message.text())) refused.push(message.text());
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.goto(`${app.base}/api/projects/${project.id}/pages/derivation`);

  await expect(page.locator("#eq .katex")).toHaveCount(2, { timeout: 10_000 });
  // The project's \Ham became a hat over an H, which KaTeX writes as an
  // `mover` in its MathML, and nothing was left as an error.
  await expect(page.locator("#eq .katex-mathml mover")).toHaveCount(1);
  await expect(page.locator("#eq .katex-error")).toHaveCount(0);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.status === "loaded" && face.family.startsWith("KaTeX")).length;
  });
  expect(fonts).toBeGreaterThan(0);
  expect(refused).toEqual([]);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
});
