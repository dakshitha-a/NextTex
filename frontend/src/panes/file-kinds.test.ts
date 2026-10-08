import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  ATTACHABLE,
  extensionOf,
  hasThumbnail,
  iconFor,
  isAttachable,
  isBib,
  isCode,
  isData,
  isScript,
  isTeX,
  isText,
  isViewable,
  EDITABLE_TEXT_BYTES,
  READABLE_TEXT_BYTES,
  kindOf,
  learnKinds,
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
    expect(iconFor("everything.zip")).toBe("file");
    expect(iconFor("scripts/fig.py")).toBe("script");
  });

  test("a script and its style sheet are text, and code rather than prose", () => {
    // The README promised the two files the plot tool seeds could be
    // opened and changed; the editor called them binary for a year.
    expect(isText("scripts/fig.py")).toBe(true);
    expect(isText("scripts/plotstyle.mplstyle")).toBe(true);
    expect(isCode("scripts/fig.py")).toBe(true);
    expect(isCode("scripts/plotstyle.mplstyle")).toBe(true);
    expect(isCode("chapters/one.tex")).toBe(false);
    expect(isCode("notes.md")).toBe(false);
    expect(isScript("scripts/fig.py")).toBe(true);
    expect(isScript("scripts/plotstyle.mplstyle")).toBe(false);
  });

  test("any name nobody lists is text, and code rather than prose", () => {
    // The editor used to open eighteen suffixes. A program's input and
    // output, a molecule and a source file in any language are text, and
    // none of them is prose for the spell checker to underline.
    for (const name of [
      "calc/water.gjf", "calc/water.inp", "calc/water.out", "geom/benzene.xyz",
      "src/integrals.f90", "src/main.cpp", "md/run.mdp", "job.slurm", "notes.unheardof",
    ]) {
      expect(kindOf(name), name).toBe("text");
      expect(isCode(name), name).toBe(true);
    }
    expect(isCode("README")).toBe(false);
    expect(isCode("notes.txt")).toBe(false);
  });

  test("a binary is known by its name, or by what the server read in it", () => {
    expect(kindOf("calc/water.chk")).toBe("other");
    expect(kindOf("archive.zip")).toBe("other");
    // A suffix no list names, holding a binary: only the server, which has
    // the bytes, can say so, and it says so in the tree.
    expect(kindOf("calc/run.out2")).toBe("text");
    learnKinds({
      type: "dir", path: "", children: [
        { type: "dir", path: "calc", children: [
          { type: "file", path: "calc/run.out2", kind: "binary" },
        ] },
      ],
    });
    expect(kindOf("calc/run.out2")).toBe("other");
    expect(isText("calc/run.out2")).toBe(false);
    // A new tree is the whole project, so what it no longer says is gone.
    learnKinds({ type: "dir", path: "", children: [] });
    expect(kindOf("calc/run.out2")).toBe("text");
  });
});

test("the names called binary here are the server's, and its text is text", () => {
  // This side has no bytes and answers from the name, so where it calls a
  // name binary the server must too, or a file the server would open is
  // shown as a download; and the reverse, or a file the server refuses is
  // handed to the editor. `.eps` is the one difference, and it is a
  // picture to the server rather than text.
  const python = readFileSync(
    join(here, "..", "..", "..", "nexttex", "project.py"),
    "utf-8",
  );
  const listed = (name: string) => {
    const block = python.slice(python.indexOf(`${name} = {`));
    return [...block.slice(0, block.indexOf("}")).matchAll(/"(\.[a-z0-9]+)"/g)]
      .map(([, suffix]) => suffix);
  };
  const binary = listed("BINARY_SUFFIXES");
  expect(binary.length).toBeGreaterThan(20);
  for (const suffix of binary) {
    // Not text, rather than "other": an `.avif` is a picture the browser
    // draws, which is a kind the server has no reason to know.
    expect(isText(`a${suffix}`), `${suffix} is binary to the server but text here`)
      .toBe(false);
  }
  const own = readFileSync(join(here, "file-kinds.ts"), "utf-8");
  const block = own.slice(own.indexOf("const BINARY = new Set(["));
  const here_ = [...block.slice(0, block.indexOf("]);")).matchAll(/"(\.[a-z0-9]+)"/g)]
    .map(([, suffix]) => suffix)
    .filter((suffix) => suffix !== ".eps");
  expect(new Set(here_)).toEqual(new Set(binary));
  for (const suffix of listed("TEXT_SUFFIXES")) {
    expect(isText(`a${suffix}`), `${suffix} is text to the server but not here`)
      .toBe(true);
  }
});

test("the size limits are the server's", () => {
  // The editor reads a file over the first read-only and offers one over
  // the second as a download; the server is what enforces both, so a
  // number here that drifted from it would promise what it refuses.
  const limit = (file: string) => {
    const source = readFileSync(join(here, "..", "..", "..", ...file.split("/")), "utf-8");
    const found = source.match(/^MAX_TEXT_BYTES = (.+)$/m);
    expect(found, file).not.toBeNull();
    return Function(`return ${found![1]}`)() as number;
  };
  expect(EDITABLE_TEXT_BYTES).toBe(limit("server/collab/store.py"));
  expect(READABLE_TEXT_BYTES).toBe(limit("server/main.py"));
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

/** What goes with a question to the agent.
 *
 *  The server's list in `nexttex/attachments.py` is the one that refuses;
 *  this one decides what the composer tries to send. They must be the same
 *  list: a kind only the server knew would never be tried, and a kind only
 *  this file knew would be refused after the writer saw it accepted. */
describe("what can go with a question", () => {
  test("the composer and the server agree on the kinds", () => {
    const python = readFileSync(
      join(here, "..", "..", "..", "nexttex", "attachments.py"),
      "utf-8",
    );
    const block = python.slice(python.indexOf("SUFFIXES = {"));
    const server = [...block.slice(0, block.indexOf("\n}")).matchAll(/"(\.[a-z0-9]+)":/g)]
      .map(([, suffix]) => suffix)
      .sort();
    expect(server.length).toBeGreaterThan(10);
    expect([...ATTACHABLE].sort()).toEqual(server);
  });

  test("documents, code and pictures go; an archive does not", () => {
    for (const name of [
      "notes.docx", "sheet.xlsx", "talk.pptx", "paper.pdf", "README.md",
      "fit.py", "scan.tif", "photo.HEIC", "plot.svg", "shot.png",
    ]) {
      expect(isAttachable(name), name).toBe(true);
    }
    for (const name of ["project.zip", "binary.exe", "Makefile", "data.h5"]) {
      expect(isAttachable(name), name).toBe(false);
    }
  });

  test("only a picture the browser draws gets a thumbnail", () => {
    expect(hasThumbnail("shot.png")).toBe(true);
    expect(hasThumbnail("plot.svg")).toBe(true);
    expect(hasThumbnail("scan.tif")).toBe(false);
    expect(hasThumbnail("paper.pdf")).toBe(false);
  });

  test("Office files and pictures the browser cannot draw take the tree's glyphs", () => {
    expect(iconFor("lifetimes.xlsx")).toBe("data");
    expect(iconFor("reviewer-notes.docx")).toBe("tex");
    expect(iconFor("notes.odt")).toBe("tex");
    expect(iconFor("group-meeting.pptx")).toBe("slides");
    expect(iconFor("scan.tiff")).toBe("image");
    expect(iconFor("photo.heic")).toBe("image");
  });
});
