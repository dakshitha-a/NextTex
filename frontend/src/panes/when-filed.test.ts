import { describe, expect, test } from "vitest";
import { whenFiled } from "./PastConversation";

/** The stamp on a past conversation, in the words the page uses. */
describe("whenFiled", () => {
  const now = new Date(2026, 8, 20, 15, 0);
  test("today and yesterday carry the time", () => {
    expect(whenFiled("2026-09-20 14:20:00", now)).toBe("Today, 14:20");
    expect(whenFiled("2026-09-19 17:48:00", now)).toBe("Yesterday, 17:48");
  });
  test("within the week the day is named, past it the date alone", () => {
    expect(whenFiled("2026-09-16 09:14:00", now)).toMatch(/^Wednesday 16 September$/);
    expect(whenFiled("2026-09-12 09:14:00", now)).toBe("12 September");
    expect(whenFiled("2025-12-01 09:14:00", now)).toMatch(/1 December 2025/);
  });
  test("a stamp that does not parse is shown as it came", () => {
    expect(whenFiled("transcript-x", now)).toBe("transcript-x");
  });
});
