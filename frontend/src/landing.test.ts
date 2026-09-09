import { describe, expect, it } from "vitest";

import { ApiError, landingAfter } from "./api";

describe("where a failed first load sends the writer", () => {
  it("asks for a password only when the server says it does not know them", () => {
    expect(landingAfter(new ApiError(401, "unauthorized"))).toBe("signin");
    expect(landingAfter(new ApiError(403, "refused"))).toBe("signin");
  });

  it("does not ask for a password because the server has a bug", () => {
    // The regression. Every status used to lead to the sign-in screen, so a
    // 500 from /api/agent/status was indistinguishable from being signed
    // out, and the writer was asked to answer for a fault that was not
    // theirs and that a password would not fix.
    expect(landingAfter(new ApiError(500, "Something went wrong"))).toBe("offline");
    expect(landingAfter(new ApiError(502, "bad gateway"))).toBe("offline");
    expect(landingAfter(new ApiError(404, "no such route"))).toBe("offline");
  });

  it("treats a request that never arrived as the server being away", () => {
    expect(landingAfter(new TypeError("Failed to fetch"))).toBe("offline");
    expect(landingAfter(undefined)).toBe("offline");
    expect(landingAfter(null)).toBe("offline");
  });
});
