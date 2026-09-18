import { describe, expect, it } from "vitest";
import { placeMenu } from "./place-menu";

const viewport = { width: 1600, height: 600 };
const menu = { width: 184, height: 306 };

describe("placeMenu", () => {
  it("sits below its button when there is room", () => {
    const at = placeMenu({ left: 60, top: 104, flip: 78 }, menu, viewport);
    expect(at).toEqual({ left: 60, top: 104 });
  });

  it("flips above the button when there is room there and not below", () => {
    // A row 30px from the foot of a 600px window: 306px will not fit
    // under it, and the button's top is at 544, so the menu ends there.
    const at = placeMenu({ left: 60, top: 570, flip: 544 }, menu, viewport);
    expect(at.top).toBe(544 - 306);
    expect(at.top + menu.height).toBeLessThanOrEqual(viewport.height);
  });

  it("goes as low as the window allows when it fits neither way", () => {
    // A 400px window, a 306px menu, a button in the middle: no room below
    // (it would end at 506), none above (it would start at -110), so the
    // bottom edge is put a margin inside the window.
    const short = { width: 1600, height: 400 };
    const at = placeMenu({ left: 60, top: 200, flip: 174 }, menu, short);
    expect(at.top + menu.height).toBe(short.height - 8);
    expect(at.top).toBeGreaterThanOrEqual(8);
  });

  it("never starts above the window, even when the menu is taller than it", () => {
    const tiny = { width: 1600, height: 200 };
    const at = placeMenu({ left: 60, top: 100, flip: 74 }, menu, tiny);
    expect(at.top).toBe(8);
  });

  it("is pushed left until its right edge is inside", () => {
    const at = placeMenu({ left: 1500, top: 104 }, menu, viewport);
    expect(at.left + menu.width).toBe(viewport.width - 8);
    // And never past the left edge, whatever was asked.
    expect(placeMenu({ left: -40, top: 104 }, menu, viewport).left).toBe(8);
  });

  it("does not flip without a flip edge, and clamps instead", () => {
    const at = placeMenu({ left: 60, top: 570 }, menu, viewport);
    expect(at.top).toBe(viewport.height - menu.height - 8);
  });
});
