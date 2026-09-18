/** A 404 from the PDF route carries three different pieces of news.
 *
 *  The route raises 404 when `build/main.pdf` is not there, and pdflatex
 *  writes no PDF for a document with nothing in it, so "no build has ever
 *  finished", "one is running right now" and "one finished and produced no
 *  pages" arrive as the same status code. The pane said the last of the
 *  three for all of them, which meant that for the whole of a project's
 *  first build it told the writer their document was empty. It is R-044,
 *  and the Windows laptop met it as the first thing a joining writer sees.
 *
 *  The store already knows which of the three it is: `builds[document]`
 *  carries `compiling`, and a `result` that is null until a `compile_done`
 *  has landed for that document.
 */
import { describe, expect, test } from "vitest";
import { absenceFrom } from "./pdf-absence";

const NEVER_BUILT = { compiling: false, result: null };
const BUILDING = { compiling: true, result: null };
const BUILT = { compiling: false, result: { ok: true } as never };

const missing = { ok: false, status: 404 };
const broken = { ok: false, status: 500 };
const fine = { ok: true, status: 200 };

describe("why there is no preview", () => {
  test("a build in flight is not an empty document", () => {
    expect(absenceFrom(missing, BUILDING)).toBe("building");
  });

  test("a project that has never been built is not an empty document", () => {
    expect(absenceFrom(missing, NEVER_BUILT)).toBe("unbuilt");
  });

  test("a build that finished and made no pages is an empty document", () => {
    expect(absenceFrom(missing, BUILT)).toBe("empty");
  });

  test("a build rewriting the file is a build in flight, not a failure", () => {
    // The route answers 503 when the PDF changed under it mid-read, which
    // pdflatex does by rewriting the same inode in place. Nothing is
    // wrong with the document or the connection, and the next build's
    // `compile_done` fetches again.
    expect(absenceFrom({ ok: false, status: 503 }, BUILT)).toBe("building");
    expect(absenceFrom({ ok: false, status: 503 }, NEVER_BUILT)).toBe("building");
  });

  test("anything but a 404 is a failure, whatever the build is doing", () => {
    expect(absenceFrom(broken, BUILT)).toBe("unreachable");
    expect(absenceFrom(broken, BUILDING)).toBe("unreachable");
  });

  test("no answer at all is a failure, not a verdict on the document", () => {
    expect(absenceFrom(null, BUILT)).toBe("unreachable");
    expect(absenceFrom(null, NEVER_BUILT)).toBe("unreachable");
  });

  test("a PDF that arrived says nothing", () => {
    expect(absenceFrom(fine, BUILT)).toBe("");
  });

  test("with nothing known about the build, a 404 is not called empty", () => {
    // The pane can render before the store has a slice for this document.
    // Saying "empty" then is the same false statement as before, so the
    // default is the one that claims least.
    expect(absenceFrom(missing, undefined)).toBe("unbuilt");
  });
});

test("a strip with nothing on it is its own answer, whatever the build says", () => {
  // The only document went to the trash.  The 404 is the same one an
  // empty folder gets, and the pane must not offer that project a
  // template as if it were new.
  expect(absenceFrom(missing, BUILT, false)).toBe("nodocument");
  expect(absenceFrom(missing, NEVER_BUILT, false)).toBe("nodocument");
  expect(absenceFrom(missing, NEVER_BUILT, true)).toBe("unbuilt");
});
