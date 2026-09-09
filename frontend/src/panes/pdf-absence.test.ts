import { describe, expect, it } from "vitest";

import { absenceFrom } from "./pdf-absence";

describe("why there is no preview", () => {
  it("shows nothing when the pages arrived", () => {
    expect(absenceFrom({ ok: true, status: 200 })).toBe("");
  });

  it("says the document is empty only when the server said so", () => {
    // The route answers 404 with "nothing has been built yet", and that is
    // the one case where telling the writer their document produced no
    // pages is true.
    expect(absenceFrom({ ok: false, status: 404 })).toBe("empty");
  });

  it("does not blame the document for a server fault", () => {
    // The regression. Both branches set the same state, so a 500 told the
    // writer "An empty document produces no pages" about a document that
    // was fine.
    expect(absenceFrom({ ok: false, status: 500 })).toBe("unreachable");
    expect(absenceFrom({ ok: false, status: 502 })).toBe("unreachable");
  });

  it("does not blame the document for a dropped connection", () => {
    expect(absenceFrom(null)).toBe("unreachable");
  });
});
