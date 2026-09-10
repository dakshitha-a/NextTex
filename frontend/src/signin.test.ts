import { describe, expect, it } from "vitest";

import { loginRefusal } from "./signin";

describe("a sign-in the server would not start", () => {
  it("is a refusal even though the request succeeded", () => {
    // The regression, reported from Windows: the pane sat on "Starting..."
    // with nothing else on screen. The server had already explained itself,
    // in a 200 response, and the only code that could have shown the
    // sentence was watching for a thrown error that never came.
    expect(
      loginRefusal({
        ok: false,
        error:
          "Signing in from the browser needs a pseudo-terminal, which " +
          "Windows does not have.",
      }),
    ).toContain("pseudo-terminal");
  });

  it("still says something when the server gives no reason", () => {
    expect(loginRefusal({ ok: false })).toBe("The sign-in could not be started.");
    expect(loginRefusal({ ok: false, error: "" })).toBe(
      "The sign-in could not be started.",
    );
  });

  it("lets a real start through", () => {
    expect(loginRefusal({ ok: true })).toBeNull();
    expect(loginRefusal(undefined)).toBeNull();
    expect(loginRefusal(null)).toBeNull();
  });
});
