import { test, expect } from "../fixtures";

/** The three ways in, and the fields they offer.
 *
 *  Nothing covered the join tab at all, and it carried a control collapsed
 *  to two thirds of the height its own class asked for: the field sits in a
 *  container that becomes `flex-col` in that one mode, and `flex-1` in a
 *  column is a rule about height, so a basis of 0 beat `h-[28px]` and the
 *  box shrank to the 17px of its text. The other two tabs lay the same
 *  container out as a row, where `flex-1` means width, which is why it
 *  showed nowhere else.
 *
 *  Height rather than appearance, deliberately: a screenshot of this is a
 *  judgement call about whether one box looks short beside another, and the
 *  number is not.
 */

const TABS = [
  "Start something new",
  "Point at a folder",
  "Join a shared project",
] as const;

test("no field on the projects screen is shorter than the control it says it is", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  const short: string[] = [];
  for (const tab of TABS) {
    await page.getByRole("button", { name: tab }).click();
    await page.waitForTimeout(200);
    for (const fault of await page.evaluate(() => {
      const out: { tag: string; place: string; height: number }[] = [];
      const drawn = (s: CSSStyleDeclaration) =>
        s.borderTopWidth !== "0px" ||
        (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
      for (const el of document.querySelectorAll<HTMLElement>(
        "input, textarea, button",
      )) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.display === "none") continue;
        // Only controls that draw a box.  Half this screen's buttons are
        // plain text links -- "Check again", "I'm the only one here" -- and
        // those are the height of their words on purpose.  A field or a
        // filled button is a box, and a box has a size it is supposed to be.
        if (!drawn(style)) continue;
        // 24px is under every boxed control this app draws -- rows and
        // buttons are 26 or 28 -- so anything below it has been squashed by
        // its container rather than designed that way.
        if (box.height >= 24) continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          place: (el.getAttribute("placeholder") ?? el.textContent ?? "").trim().slice(0, 40),
          height: Math.round(box.height),
        });
      }
      return out;
    })) {
      short.push(`${tab}: ${fault.tag} "${fault.place}" is ${fault.height}px`);
    }
  }
  expect(short, short.join("\n")).toEqual([]);
});

test("the invite box and the folder beneath it are one pair", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "Join a shared project" }).click();

  const measured = await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('[data-testid="invite-input"]')!;
    const field = [...document.querySelectorAll<HTMLInputElement>("input")].find(
      (el) => (el.placeholder ?? "").includes("empty folder"),
    )!;
    const a = area.getBoundingClientRect();
    const b = field.getBoundingClientRect();
    return {
      sameLeft: Math.round(a.x) === Math.round(b.x),
      sameWidth: Math.round(a.width) === Math.round(b.width),
      field: Math.round(b.height),
      invite: Math.round(a.height),
    };
  });

  // One left edge and one width: they are two halves of one answer, not two
  // controls that happen to be near each other.
  expect(measured.sameLeft, "the two boxes do not share a left edge").toBe(true);
  expect(measured.sameWidth, "the two boxes are different widths").toBe(true);
  // The path is one line and the invite is a paste target, so they are not
  // the same height -- but the path is a full control, not a slot.
  expect(measured.field).toBe(28);
  expect(measured.invite).toBeGreaterThan(measured.field);
});
