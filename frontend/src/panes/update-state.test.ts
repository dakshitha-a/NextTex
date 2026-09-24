import { describe, expect, it } from "vitest";

import { stateOf } from "./UpdateFooter";

const report = (over: object) => ({
  kind: "report" as const,
  report: {
    checkout: true, checked: true, head: "abc1234", behind: 0, changing: 0,
    commits: [], dirty: [], rebuild: false, build_ok: true, build_reason: "",
    can_update: false, reason: "", restart: "manual", error: "",
    updating: false, phase: "", ...over,
  },
});

describe("what the band's update control says", () => {
  it("says a failed check failed, rather than offering one", () => {
    expect(stateOf(report({ checked: false }) as never, null)).toBe("unreachable");
  });
  it("keeps an update it already knew was waiting through a failed check", () => {
    expect(stateOf(report({ checked: false }) as never, null, true)).toBe("waiting");
  });
  it("and is at rest after a check that reached the repository and found nothing", () => {
    expect(stateOf(report({}) as never, null, true)).toBe("resting");
  });
  it("is waiting when a reachable check finds an update that changes NextTex", () => {
    expect(stateOf(report({ behind: 3, changing: 2, can_update: true }) as never, null)).toBe("waiting");
  });
});
