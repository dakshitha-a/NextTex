import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  extensionOf,
  iconFor,
  isBib,
  isData,
  isTeX,
  isText,
  isViewable,
  kindOf,
} from "./file-kinds";

const here = dirname(fileURLToPath(import.meta.url));

describe("what kind of thing a file is", () => {
  test("an extension is the last dot in the name, not in the path", () => {
    expect(extensionOf("chapters/01.intro/main.tex")).toBe(".tex");
    expect(extensionOf("figures/plot.final.pdf")).toBe(".pdf");
    expect(extensionOf("Makefile")).toBe("");
  });

  test("a leading dot is a name, not an extension", () => {
    // `.gitignore` is the file. Slicing at the first dot would call it an
    // extension of itself and then refuse to open it as text.
    expect(extensionOf(".gitignore")).toBe("");
    expect(isText(".gitignore")).toBe(true);
    expect(isText("figures/.gitkeep")).toBe(true);
  });

  test("a file with no extension is text, because it is a README", () => {
    expect(kindOf("LICENSE")).toBe("text");
  });

  test("a PDF is its own kind, not an image and not a binary", () => {
    // This is the bug the registry exists to fix. The server calls a .pdf
    // an image, so the editor is skipped; the old renderable set excluded
    // it, so the viewer refused it; and it fell through to a Download
    // button in a pane that had PDF.js loaded already.
    expect(kindOf("figures/spectrum.pdf")).toBe("pdf");
    expect(isViewable("figures/spectrum.pdf")).toBe(true);
  });

  test("case does not decide anything", () => {
    expect(kindOf("FIGURES/PLOT.PNG")).toBe("image");
    expect(isTeX("MAIN.TEX")).toBe(true);
  });

  test("PostScript is offered as a download rather than refused twice", () => {
    // PDF.js does not read PostScript and Ghostscript is not a dependency
    // this app is going to take, so `.eps` is honestly "other".
    expect(kindOf("figures/old.eps")).toBe("other");
    expect(isViewable("figures/old.eps")).toBe(false);
  });

  test("bibliographies and sources are told apart by the registry", () => {
    expect(isBib("references.bib")).toBe(true);
    expect(isBib("references.bibtex")).toBe(false);
    expect(isTeX("main.ltx")).toBe(true);
    expect(isTeX("main.texinfo")).toBe(false);
  });

  test("the glyph follows the kind", () => {
    expect(iconFor("main.tex")).toBe("tex");
    expect(iconFor("references.bib")).toBe("bib");
    expect(iconFor("thesis.cls")).toBe("style");
    expect(iconFor("data/runs.csv")).toBe("data");
    expect(iconFor("figures/pes.pdf")).toBe("pdf");
    expect(iconFor("figures/pes.png")).toBe("image");
    expect(iconFor("notes.odt")).toBe("file");
  });
});

test("every suffix the server will hand over as text is text here too", () => {
  // Not equality: the two sets answer different questions. The server's
  // decides what may be read off disk as UTF-8, which is a question about
  // bytes; this one decides how to draw a row and which viewer to open. But
  // containment has to hold in this direction, because a file the server
  // will happily open and this set does not know about is shown to the
  // writer as an unopenable binary -- which is exactly the class of bug
  // that had `.pdf` stuck between three disagreeing answers.
  const python = readFileSync(
    join(here, "..", "..", "..", "nexttex", "project.py"),
    "utf-8",
  );
  const block = python.slice(python.indexOf("TEXT_SUFFIXES"));
  const suffixes = [...block.slice(0, block.indexOf("}")).matchAll(/"(\.[a-z0-9]+)"/g)]
    .map(([, suffix]) => suffix);

  expect(suffixes.length).toBeGreaterThan(8);
  for (const suffix of suffixes) {
    expect(isText(`a${suffix}`), `${suffix} is text to the server but not here`)
      .toBe(true);
  }
});

/** Which files a writer would plot.
 *
 *  The file-tree row offers "Plot this" on these and on nothing else,
 *  because an item that explains itself by failing is worse than no item.
 */
describe("what looks like a dataset", () => {
  test("the formats data actually arrives in", () => {
    for (const name of [
      "data/runs.csv", "data/runs.tsv", "spectra.dat", "columns.txt",
      "measured.json", "big.parquet", "sheet.xlsx", "cube.h5", "grid.npy",
    ]) {
      expect(isData(name)).toBe(true);
    }
  });

  test("a build log is not a dataset, and neither is the writing", () => {
    for (const name of [
      "main.log", "main.tex", "references.bib", "figures/plot.pdf",
      "scripts/plot.py", "notes", "main.aux",
    ]) {
      expect(isData(name)).toBe(false);
    }
  });
});
