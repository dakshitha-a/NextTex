import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openFolders } from "../fixtures";

/** A scanned page and a JPEG 2000 figure are drawn, not left blank.
 *
 *  pdf.js 6 decodes CCITT and JBIG2 images with one WebAssembly module and
 *  JPEG 2000 with another, and finds both through `getDocument`'s
 *  `wasmUrl`. NextTex passed none and shipped neither, so a scanned book,
 *  one CCITT image a page, opened as blank pages and a journal's JPEG 2000
 *  figures went missing, with only a warning in the console.
 *
 *  Each fixture is one page, 300 points square, holding one image: a black
 *  square on white, a quarter in from each edge, so the middle of a drawn
 *  page is dark and its corner light. The CCITT image is 400 pixels square,
 *  written by ImageMagick as raw Group 4 (`convert page.pbm group4:page.g4`);
 *  the JPEG 2000 one is a 64 pixel grey codestream with one component
 *  (`convert ... -alpha off -colorspace Gray j2k:page.j2k`).
 *  Poppler draws both.
 */

const G4 =
  "////////////////87FQyRf/////////////////////////////////////////////////////////////////" +
  "//////////////////H////////////////wAQAQ";

const J2K = [
  "/0//UQApAAAAAABAAAAAQAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAABBwEB/1IADAAAAAEABQQEAAH/XAATQEBISFBISFBI",
  "SFBISFBISFD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi40LjD/kAAKAAAAAAGgAAH/k9+AMArUXVlUf8/A",
  "Gn4AsfgDAA/ZR4TwPw/ZRdFbEIBhXp1/x9olH2icH1CACePjQNGGp3trHDaTqs9Utq1/HP0a5miiyNjnDN87ewxrXjvUHxF4",
  "gu1o3q5zy3o4tV3RnrnH2j8faQQfULAZGdSO+uMk0MqsAkRcfBMDJIvpOeJZ0ceKRjxu3znPG7ya4R/JkTfStt1pSmBkhVne",
  "eZdbr0V6E1UYFCwe7dMV8xZhCleC3HQBQFg2b9OoRb6caJZXz8C2fgWw+0WAj9bD6e4WpL6OtRzhM7/KPKbhKWPhR9/O7b8C",
  "yIDYrXUYDgZV1CgwCIXC4GBvTS6oF2auNxS2qzID92huXymIlNXO/AmomDWyYxjuu8mBMoDGqoaiBUfP1f9/JMujAg2RaFGJ",
  "ukjy2ejfE8i5hG+Lz8faSR9pFB9QWLX0o10FP99yQoeIgNnnviL3q9IDkm7MMTFBL0PL3LpK3OvfH5UoKFX0OxwOXpjDJ96T",
  "Ykw5hyQbf8Oi4RsBNrD/axGCUt+UA/w6XRPO0O4d0f/Z",
].join("");

/** One page holding one image, with no cross-reference table: pdf.js
 *  rebuilds one, as it does for most PDFs a figure script writes. */
function onePage(image: Buffer, size: number, dictionary: string): Buffer {
  const content = Buffer.from("q 300 0 0 300 0 0 cm /Im0 Do Q");
  const stream = (head: string, body: Buffer) =>
    Buffer.concat([Buffer.from(`<< ${head} /Length ${body.length} >>\nstream\n`), body, Buffer.from("\nendstream")]);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] " +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"),
    stream(`/Type /XObject /Subtype /Image /Width ${size} /Height ${size} ${dictionary}`, image),
    stream("", content),
  ];
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n"),
    ...objects.flatMap((body, index) => [Buffer.from(`${index + 1} 0 obj `), body, Buffer.from(" endobj\n")]),
    Buffer.from("trailer << /Root 1 0 R >>\n%%EOF\n"),
  ]);
}

const SCANNED = onePage(Buffer.from(G4, "base64"), 400,
  "/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode " +
  "/DecodeParms << /K -1 /Columns 400 /Rows 400 >>");
const JPX = onePage(Buffer.from(J2K, "base64"), 64, "/Filter /JPXDecode");

/** The grey, 0 to 255, at the middle and at a corner of what is drawn: the
 *  open page's canvas, or the card's thumbnail. NaN until there is one. */
async function greys(tab: Page, where: "page" | "card"): Promise<{ middle: number; corner: number }> {
  return tab.evaluate(async (where) => {
    let source: HTMLCanvasElement | HTMLImageElement | null;
    if (where === "page") {
      source = document.querySelector('[data-testid="file-view"] .nx-page canvas:not(.nx-figures)');
    } else {
      source = document.querySelector('[data-testid="file-card"] img');
      if (source && !(source as HTMLImageElement).complete) await (source as HTMLImageElement).decode();
    }
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source?.width ?? 0;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source?.height ?? 0;
    if (!source || !width || !height) return { middle: NaN, corner: NaN };
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [width, height];
    const context = canvas.getContext("2d")!;
    context.drawImage(source, 0, 0);
    const grey = (x: number, y: number) => {
      const [r, g, b] = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      return Math.round((r + g + b) / 3);
    };
    return { middle: grey(width / 2, height / 2), corner: grey(width * 0.1, height * 0.1) };
  }, where);
}

test.beforeEach(({ project }) => {
  mkdirSync(join(project.root, "refs"), { recursive: true });
  writeFileSync(join(project.root, "refs", "scanned.pdf"), SCANNED);
  writeFileSync(join(project.root, "refs", "figure.pdf"), JPX);
});

for (const [name, what] of [["scanned.pdf", "a CCITT scan"], ["figure.pdf", "a JPEG 2000 figure"]] as const) {
  test(`${what} is drawn when the file is opened`, async ({ tab }) => {
    const path = `refs/${name}`;
    await openFolders(tab, path);
    await tab.locator(`[role="tree"] [data-path="${path}"]`).click();
    await expect.poll(async () => (await greys(tab, "page")).corner, { timeout: 30_000 }).toBeGreaterThan(200);
    // The page is there; the image on it is what was missing.
    await expect.poll(async () => (await greys(tab, "page")).middle, { timeout: 15_000 }).toBeLessThan(90);
  });

  test(`${what} is drawn in its file card`, async ({ tab }) => {
    const path = `refs/${name}`;
    await openFolders(tab, path);
    await tab.locator(`[role="tree"] [data-path="${path}"]`).hover();
    await expect(tab.getByTestId("file-card").locator("img")).toBeVisible({ timeout: 15_000 });
    const drawn = await greys(tab, "card");
    expect(drawn.corner).toBeGreaterThan(200);
    expect(drawn.middle).toBeLessThan(90);
  });
}
